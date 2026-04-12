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
// 图片裁剪组件 - 支持裁剪、缩放、PNG透明
export class ImageCropper {
    constructor(options = {}) {
        this.options = {
            aspectRatio: options.aspectRatio || null, // null = 自由裁剪, 1 = 正方形, 16/9 等
            outputWidth: options.outputWidth || 800,
            outputHeight: options.outputHeight || 800,
            outputFormat: options.outputFormat || 'image/jpeg', // 'image/png' 支持透明
            quality: options.quality || 0.9,
            maxFileSize: options.maxFileSize || 5 * 1024 * 1024, // 5MB
            onComplete: options.onComplete || (() => {}),
            onCancel: options.onCancel || (() => {}),
            title: options.title || '裁剪图片',
            preserveTransparency: options.preserveTransparency || false, // PNG透明支持
        };

        this.image = null;
        this.scale = 1;
        this.minScale = 0.5;
        this.maxScale = 3;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.lastTouchDistance = 0;
        this.container = null;
    }

    // 打开裁剪器
    open(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject(new Error('请选择图片文件'));
                return;
            }

            if (file.size > this.options.maxFileSize) {
                reject(new Error(`图片大小不能超过${Math.round(this.options.maxFileSize / 1024 / 1024)}MB`));
                return;
            }

            // 检测是否为PNG（支持透明）
            if (file.type === 'image/png' && this.options.preserveTransparency) {
                this.options.outputFormat = 'image/png';
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    this.image = img;
                    this.showCropper(resolve, reject);
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.readAsDataURL(file);
        });
    }

    // 显示裁剪界面
    showCropper(resolve, reject) {
        // 🔥 检测是否为小屏幕
        const isMobile = window.innerWidth <= 500 || window.innerHeight <= 600;
        const baseSize = isMobile ? 220 : 280;

        // 🔥 动态计算裁剪框的宽高比例
        const targetRatio = this.options.outputWidth / this.options.outputHeight;
        this.cWidth = baseSize;
        this.cHeight = baseSize;
        if (targetRatio < 1) { // 长图 (如手机壁纸)
            this.cWidth = baseSize * targetRatio;
        } else if (targetRatio > 1) { // 宽图
            this.cHeight = baseSize / targetRatio;
        }

        const imgAspect = this.image.width / this.image.height;
        const containerAspect = this.cWidth / this.cHeight;

        // 🔥 使用 cover 模式完美填满裁剪框
        if (imgAspect > containerAspect) {
            this.scale = this.cHeight / this.image.height;
        } else {
            this.scale = this.cWidth / this.image.width;
        }

        // 🔥 设定对称的缩放极限，确保滑块（125）完美居中
        this.minScale = this.scale * 0.2;
        this.maxScale = this.scale * 1.8;

        this.offsetX = (this.cWidth - this.image.width * this.scale) / 2;
        this.offsetY = (this.cHeight - this.image.height * this.scale) / 2;

        // 创建裁剪界面
        this.container = document.createElement('div');
        this.container.className = 'image-cropper-overlay';
        this.container.innerHTML = `
            <div class="image-cropper-modal">
                <div class="cropper-header">
                    <button class="cropper-cancel-btn" id="cropper-cancel">取消</button>
                    <span class="cropper-title">${this.options.title}</span>
                    <button class="cropper-confirm-btn" id="cropper-confirm">确定</button>
                </div>

                <div class="cropper-workspace">
                    <div class="cropper-canvas-container" id="cropper-container" style="width: ${this.cWidth}px; height: ${this.cHeight}px; margin: 0 auto; position: relative; border-radius: 12px; overflow: hidden; background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 20px 20px;">
                        <canvas id="cropper-canvas" width="${this.cWidth}" height="${this.cHeight}" style="position: absolute; top: 0; left: 0; cursor: move; touch-action: none;"></canvas>
                        <div class="cropper-grid"></div>
                    </div>

                    <div class="cropper-hint">拖动图片调整位置，双指缩放</div>

                    <div class="cropper-controls">
                        <button class="cropper-zoom-btn" id="zoom-out">
                            <i class="fa-solid fa-minus"></i>
                        </button>
                        <input type="range" id="zoom-slider" min="50" max="200" value="125" class="cropper-slider">
                        <button class="cropper-zoom-btn" id="zoom-in">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>

                    <div class="cropper-actions">
                        <button class="cropper-action-btn" id="rotate-left">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                        <button class="cropper-action-btn" id="reset-btn">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </button>
                        <button class="cropper-action-btn" id="rotate-right">
                            <i class="fa-solid fa-rotate-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 添加样式
        this.addStyles();

        // 添加到页面
        document.body.appendChild(this.container);

        // 🔥 阻止点击事件冒泡，防止关闭手机面板
        this.container.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        this.container.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        this.container.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        }, { passive: true });

        // 绑定事件
        this.bindEvents(resolve, reject);

        // 🔥 初始化滑块位置 - 滑块范围50-200对应minScale到maxScale
        const slider = document.getElementById('zoom-slider');
        if (slider) {
            // 计算当前缩放在范围内的百分比位置
            const percent = (this.scale - this.minScale) / (this.maxScale - this.minScale);
            // 映射到滑块范围 50-200
            slider.value = 50 + percent * 150;
        }

        // 绘制初始图片
        this.draw();
    }

    // 添加CSS样式
    addStyles() {
        if (document.getElementById('image-cropper-styles')) return;

        const style = document.createElement('style');
        style.id = 'image-cropper-styles';
        style.textContent = `
            .image-cropper-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                background: rgba(0, 0, 0, 0.9) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                z-index: 2147483647 !important;
                padding: 10px !important;
                box-sizing: border-box !important;
                overflow: auto !important;
            }

            .image-cropper-modal {
                background: #1a1a1a !important;
                border-radius: 16px !important;
                width: 300px !important;
                max-width: 90vw !important;
                max-height: 90vh !important;
                overflow-y: auto !important;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5) !important;
                position: relative !important;
            }

            .cropper-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid #333;
                background: #1a1a1a;
                border-radius: 16px 16px 0 0;
            }

            .cropper-title {
                font-size: 16px;
                font-weight: 600;
                color: #fff;
            }

            .cropper-cancel-btn, .cropper-confirm-btn {
                background: transparent;
                border: none;
                font-size: 15px;
                cursor: pointer;
                padding: 6px 12px;
                border-radius: 6px;
            }

            .cropper-cancel-btn {
                color: #999;
            }

            .cropper-confirm-btn {
                color: #07c160;
                font-weight: 600;
            }

            .cropper-workspace {
                padding: 20px;
            }

            .cropper-canvas-container {
                width: 280px;
                height: 280px;
                margin: 0 auto;
                position: relative;
                border-radius: 12px;
                overflow: hidden;
                background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 20px 20px;
            }

            #cropper-canvas {
                position: absolute;
                top: 0;
                left: 0;
                cursor: move;
                touch-action: none;
            }

            .cropper-grid {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                background:
                    linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px);
                background-size: 33.33% 33.33%;
            }

            .cropper-hint {
                text-align: center;
                font-size: 12px;
                color: #666;
                margin: 12px 0;
            }

            .cropper-controls {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                margin-bottom: 15px;
            }

            .cropper-zoom-btn {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: #333;
                border: none;
                color: #fff;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .cropper-zoom-btn:active {
                background: #444;
            }

            .cropper-slider {
                width: 140px;
                height: 4px;
                -webkit-appearance: none;
                background: #333;
                border-radius: 2px;
                outline: none;
            }

            .cropper-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: #07c160;
                cursor: pointer;
            }

            .cropper-actions {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 20px;
            }

            .cropper-action-btn {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: #333;
                border: none;
                color: #fff;
                font-size: 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .cropper-action-btn:active {
                background: #444;
            }

            /* 📱 移动端响应式 */
            @media (max-width: 500px), (max-height: 600px) {
                .image-cropper-overlay {
                    padding: 5px !important;
                }

                .image-cropper-modal {
                    width: 240px !important;
                    max-width: 95vw !important;
                    max-height: 85vh !important;
                    border-radius: 12px !important;
                }

                .cropper-header {
                    padding: 8px 10px !important;
                    border-radius: 12px 12px 0 0 !important;
                }

                .cropper-title {
                    font-size: 13px !important;
                }

                .cropper-cancel-btn, .cropper-confirm-btn {
                    font-size: 12px !important;
                    padding: 4px 8px !important;
                }

                .cropper-workspace {
                    padding: 8px !important;
                }

                .cropper-canvas-container {
                    width: 180px !important;
                    height: 180px !important;
                }

                #cropper-canvas {
                    width: 180px !important;
                    height: 180px !important;
                }

                .cropper-hint {
                    font-size: 10px !important;
                    margin: 4px 0 !important;
                }

                .cropper-controls {
                    gap: 6px !important;
                    margin-bottom: 6px !important;
                }

                .cropper-zoom-btn {
                    width: 26px !important;
                    height: 26px !important;
                    font-size: 10px !important;
                }

                .cropper-slider {
                    width: 70px !important;
                }

                .cropper-actions {
                    gap: 10px !important;
                }

                .cropper-action-btn {
                    width: 30px !important;
                    height: 30px !important;
                    font-size: 13px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 绑定事件
    bindEvents(resolve, reject) {
        const canvas = document.getElementById('cropper-canvas');
        const container = document.getElementById('cropper-container');
        const slider = document.getElementById('zoom-slider');

        // 取消按钮
        document.getElementById('cropper-cancel')?.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.close();
            this.options.onCancel();
            reject(new Error('用户取消'));
        });

        // 确定按钮
        document.getElementById('cropper-confirm')?.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const result = this.crop();
            this.close();
            this.options.onComplete(result);
            resolve(result);
        });

        // 🔥 以画布中心为基点缩放的辅助函数
        const zoomAroundCenter = (newScale) => {
            const centerX = this.cWidth / 2;
            const centerY = this.cHeight / 2;

            // 计算当前图片中心相对于画布中心的位置
            const oldImgCenterX = this.offsetX + (this.image.width * this.scale) / 2;
            const oldImgCenterY = this.offsetY + (this.image.height * this.scale) / 2;

            // 计算缩放比例
            const scaleRatio = newScale / this.scale;

            // 更新缩放
            this.scale = newScale;

            // 计算新的图片中心位置（保持相对于画布中心的比例）
            const newImgCenterX = centerX + (oldImgCenterX - centerX) * scaleRatio;
            const newImgCenterY = centerY + (oldImgCenterY - centerY) * scaleRatio;

            // 更新偏移量
            this.offsetX = newImgCenterX - (this.image.width * this.scale) / 2;
            this.offsetY = newImgCenterY - (this.image.height * this.scale) / 2;
        };

        // 🔥 辅助函数：根据缩放值更新滑块位置
        const updateSliderFromScale = () => {
            const percent = (this.scale - this.minScale) / (this.maxScale - this.minScale);
            slider.value = 50 + percent * 150;
        };

        // 缩放滑块 - 滑块范围50-200对应minScale到maxScale
        slider?.addEventListener('input', (e) => {
            const percent = (e.target.value - 50) / 150;
            const newScale = this.minScale + percent * (this.maxScale - this.minScale);
            zoomAroundCenter(newScale);
            this.clampPosition();
            this.draw();
        });

        // 放大按钮
        document.getElementById('zoom-in')?.addEventListener('click', () => {
            const newScale = Math.min(this.scale * 1.2, this.maxScale);
            zoomAroundCenter(newScale);
            updateSliderFromScale();
            this.clampPosition();
            this.draw();
        });

        // 缩小按钮
        document.getElementById('zoom-out')?.addEventListener('click', () => {
            const newScale = Math.max(this.scale / 1.2, this.minScale);
            zoomAroundCenter(newScale);
            updateSliderFromScale();
            this.clampPosition();
            this.draw();
        });

        // 重置按钮
        document.getElementById('reset-btn')?.addEventListener('click', () => {
            const imgAspect = this.image.width / this.image.height;
            const containerAspect = this.cWidth / this.cHeight;
            // 🔥 重置时也使用cover模式
            if (imgAspect > containerAspect) {
                this.scale = this.cHeight / this.image.height;
            } else {
                this.scale = this.cWidth / this.image.width;
            }
            this.offsetX = (this.cWidth - this.image.width * this.scale) / 2;
            this.offsetY = (this.cHeight - this.image.height * this.scale) / 2;
            this.rotation = 0;
            updateSliderFromScale();
            this.draw();
        });

        // 旋转按钮（暂时简化，不实现复杂旋转）
        this.rotation = 0;
        document.getElementById('rotate-left')?.addEventListener('click', () => {
            this.rotation -= 90;
            this.draw();
        });
        document.getElementById('rotate-right')?.addEventListener('click', () => {
            this.rotation += 90;
            this.draw();
        });

        // 鼠标拖拽
        let startX, startY, startOffsetX, startOffsetY;

        canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startOffsetX = this.offsetX;
            startOffsetY = this.offsetY;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.offsetX = startOffsetX + (e.clientX - startX);
            this.offsetY = startOffsetY + (e.clientY - startY);
            this.clampPosition();
            this.draw();
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // 触摸拖拽
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                startOffsetX = this.offsetX;
                startOffsetY = this.offsetY;
            } else if (e.touches.length === 2) {
                this.lastTouchDistance = this.getTouchDistance(e.touches);
            }
            e.preventDefault();
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) {
                this.offsetX = startOffsetX + (e.touches[0].clientX - startX);
                this.offsetY = startOffsetY + (e.touches[0].clientY - startY);
                this.clampPosition();
                this.draw();
            } else if (e.touches.length === 2) {
                // 双指缩放
                const newDistance = this.getTouchDistance(e.touches);
                const scaleChange = newDistance / this.lastTouchDistance;
                this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * scaleChange));
                this.lastTouchDistance = newDistance;
                slider.value = (this.scale / ((this.minScale + this.maxScale) / 2)) * 100;
                this.clampPosition();
                this.draw();
            }
            e.preventDefault();
        }, { passive: false });

        canvas.addEventListener('touchend', () => {
            this.isDragging = false;
        });

        // 鼠标滚轮缩放
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * delta));
            slider.value = (this.scale / ((this.minScale + this.maxScale) / 2)) * 100;
            this.clampPosition();
            this.draw();
        }, { passive: false });
    }

    // 获取双指距离
    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // 限制位置，防止拖出边界
    clampPosition() {
        const imgWidth = this.image.width * this.scale;
        const imgHeight = this.image.height * this.scale;

        // 允许图片部分超出，但至少要覆盖画布中心区域
        const minOverlapX = this.cWidth * 0.3;
        const minOverlapY = this.cHeight * 0.3;

        this.offsetX = Math.max(minOverlapX - imgWidth, Math.min(this.cWidth - minOverlapX, this.offsetX));
        this.offsetY = Math.max(minOverlapY - imgHeight, Math.min(this.cHeight - minOverlapY, this.offsetY));
    }

    // 绘制图片
    draw() {
        const canvas = document.getElementById('cropper-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // 清空画布（透明背景）
        ctx.clearRect(0, 0, this.cWidth, this.cHeight);

        // 保存状态
        ctx.save();

        // 移动到图片中心进行旋转
        const centerX = this.offsetX + (this.image.width * this.scale) / 2;
        const centerY = this.offsetY + (this.image.height * this.scale) / 2;

        ctx.translate(centerX, centerY);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);

        // 绘制图片
        ctx.drawImage(
            this.image,
            this.offsetX,
            this.offsetY,
            this.image.width * this.scale,
            this.image.height * this.scale
        );

        // 恢复状态
        ctx.restore();
    }

    // 裁剪并导出
    crop() {
        const outputCanvas = document.createElement('canvas');

        // 🔥 绝对信任 output 尺寸
        outputCanvas.width = this.options.outputWidth;
        outputCanvas.height = this.options.outputHeight;

        const ctx = outputCanvas.getContext('2d');

        // 🔥 只有 JPEG 格式才填充白色背景（JPEG 不支持透明）
        // PNG 格式保持透明，让图片本身的透明度生效
        if (this.options.outputFormat === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        }

        // 🔥 将缩放比例改为只基于宽度
        const scaleRatio = outputCanvas.width / this.cWidth;

        // 保存状态
        ctx.save();

        // 处理旋转
        const centerX = (this.offsetX + (this.image.width * this.scale) / 2) * scaleRatio;
        const centerY = (this.offsetY + (this.image.height * this.scale) / 2) * scaleRatio;

        ctx.translate(centerX, centerY);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);

        // 绘制缩放后的图片
        ctx.drawImage(
            this.image,
            this.offsetX * scaleRatio,
            this.offsetY * scaleRatio,
            this.image.width * this.scale * scaleRatio,
            this.image.height * this.scale * scaleRatio
        );

        ctx.restore();

        // 导出
        return outputCanvas.toDataURL(this.options.outputFormat, this.options.quality);
    }

    // 关闭裁剪器
    close() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.image = null;
    }
}

// 便捷方法：打开图片裁剪器
export async function cropImage(file, options = {}) {
    const cropper = new ImageCropper(options);
    return cropper.open(file);
}

