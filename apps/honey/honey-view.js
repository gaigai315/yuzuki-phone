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
export class HoneyView {
    constructor(app) {
        this.app = app;
        this.currentPage = 'recommend';
        this.currentSceneData = null;
        this.selectedTopic = null;
        this.giftOptions = [
            { name: '玫瑰', icon: '🌹', price: 1 },
            { name: '茄子', icon: '🍆', price: 5 },
            { name: '桃子', icon: '🍑', price: 5 },
            { name: '亲吻', icon: '💋', price: 10 },
            { name: '手铐', icon: '🔗', price: 188 },
            { name: '链条', icon: '⛓️', price: 288 },
            { name: '项圈', icon: '📿', price: 388 },
            { name: '皮鞭', icon: '🪢', price: 666 },
            { name: '跑车', icon: '🏎️', price: 520 },
            { name: '火箭', icon: '🚀', price: 100 },
            { name: '钻石', icon: '💎', price: 1000 },
            { name: '皇冠', icon: '👑', price: 10000 },
            { name: '香槟', icon: '🍾', price: 88888 }
        ];
        this._outsideClickHandler = null;
        this.recommendTopics = this._getDefaultTopics();
        this._isGeneratingScene = false;
        this._pendingGenerateTopic = '';
        this._settingsReturnPage = 'recommend';
        this._liveBackTarget = 'home';
        this._liveEntrySource = 'direct';
        this._customVideoListExpanded = false;
        this.cssPromise = null;
        this._sessionKey = '';
        this._avatarManifest = null;
        this._avatarManifestLoaded = false;
        this._avatarManifestLoading = false;
        this._isLiveRankExpanded = false;
        this.isScenePanelOpen = false;
        this._recommendRefreshStatus = 'idle'; // idle | loading | success | error
        this._recommendRefreshTimer = null;
        this._liveRefreshStatus = 'idle'; // idle | loading | success | error
        this._liveRefreshTimer = null;
        this._honeyTtsAudio = new Audio();
        this._honeyTtsPlayingBtn = null;
        this._honeyTtsActiveBlobUrl = '';
        this._honeyTtsActiveBlobCached = false;
        this._honeyTtsCache = new Map();
        this._honeyTtsCacheOrder = [];
        this._honeyTtsMaxCacheSize = 12;
        this._activeLiveSettlement = null;
        this._dismissedLiveCollabRequestFingerprint = '';
        this._isEndCollabConfirmOpen = false;
        this._liveVisibilityModalOpen = false;
        this._liveViewportCleanup = null;
        this._liveBatchTimer = null;
        this._livePendingUserLines = [];
        this._livePendingDisplayLines = [];
        this._liveSendInFlight = false;
        this._isGiftPickerOpen = false;
        this._lastLiveTurnRetry = null;
        this._isSceneTagHistoryOpen = false;
        this._isRetaggingSceneNai = false;
        this._restoreSessionState();
        this._loadCSS();
    }

    _getHoneyBaseUrl() {
        const normalizeBase = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            return raw.endsWith('/') ? raw : `${raw}/`;
        };

        const configured = normalizeBase(window.VirtualPhone?.extensionBaseUrl);
        if (configured) return configured;

        const metaBase = normalizeBase(new URL('../../', import.meta.url).href);
        const runtimePath = String(window.location?.pathname || '');
        const runtimeMatch = runtimePath.match(/(\/scripts\/extensions\/third-party\/)([^/]+)(\/)/i);
        const metaMatch = metaBase.match(/(\/scripts\/extensions\/third-party\/)([^/]+)(\/)/i);
        if (!runtimeMatch || !metaMatch || runtimeMatch[2] === metaMatch[2]) {
            return metaBase;
        }

        return metaBase.replace(metaMatch[0], `${metaMatch[1]}${runtimeMatch[2]}${metaMatch[3]}`);
    }

    _getHoneyAssetUrl(relPath) {
        const safeRel = String(relPath || '').replace(/^\/+/, '');
        const baseUrl = this._getHoneyBaseUrl();
        return new URL(`apps/honey/${safeRel}`, baseUrl).href;
    }

    _normalizeUploadedBackgroundUrl(value) {
        if (value === null || value === undefined) return '';
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        const raw = String(value).trim();
        if (!raw || raw === '[object Object]' || raw === 'undefined' || raw === 'null') return '';
        if (/\[object\s+object\]/i.test(raw)) return '';
        if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

        const normalized = raw.replace(/\\/g, '/');
        const lower = normalized.toLowerCase();
        const bgToken = '/backgrounds/';
        const bgIdx = lower.indexOf(bgToken);
        if (bgIdx >= 0) {
            const suffix = normalized.slice(bgIdx + bgToken.length).replace(/^\/+/, '').trim();
            if (!suffix) return '';
            return `/backgrounds/${suffix}`;
        }

        // 绝对 URL：优先保留 URL；若包含 backgrounds 目录则规范为相对路径
        if (/^(?:https?:)?\/\//i.test(normalized)) {
            try {
                const urlObj = new URL(normalized, window.location?.origin || undefined);
                const pathLower = String(urlObj.pathname || '').toLowerCase();
                const pathBgIdx = pathLower.indexOf(bgToken);
                if (pathBgIdx >= 0) {
                    const suffix = String(urlObj.pathname || '').slice(pathBgIdx + bgToken.length).replace(/^\/+/, '').trim();
                    if (suffix) return `/backgrounds/${suffix}`;
                }
            } catch (e) {
                // ignore parse error and fallback to raw URL
            }
            return normalized;
        }

        // 处理 Windows/Unix 文件系统路径，提取文件名映射到 /backgrounds/
        const isWindowsPath = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//');
        const looksLikeFsPath = isWindowsPath || normalized.startsWith('/');
        if (looksLikeFsPath) {
            const fileName = normalized.split('/').filter(Boolean).pop() || '';
            if (fileName) return `/backgrounds/${fileName}`;
        }

        if (normalized.startsWith('backgrounds/')) return `/${normalized}`;
        if (normalized.startsWith('/')) return normalized;
        return `/backgrounds/${normalized.replace(/^\/+/, '')}`;
    }

    _isManagedBackgroundUrl(value) {
        return /^\/backgrounds\/[^?#]+/i.test(String(value || '').trim());
    }

    _collectUploadUrlCandidates(input, out = [], depth = 0) {
        if (input === null || input === undefined || depth > 2) return out;
        if (typeof input === 'string' || typeof input === 'number') {
            out.push(input);
            return out;
        }
        if (Array.isArray(input)) {
            input.forEach(item => this._collectUploadUrlCandidates(item, out, depth + 1));
            return out;
        }
        if (typeof input === 'object') {
            this._collectUploadUrlCandidates(input.url, out, depth + 1);
            this._collectUploadUrlCandidates(input.path, out, depth + 1);
            this._collectUploadUrlCandidates(input.file, out, depth + 1);
            this._collectUploadUrlCandidates(input.filename, out, depth + 1);
            this._collectUploadUrlCandidates(input.name, out, depth + 1);
            this._collectUploadUrlCandidates(input.src, out, depth + 1);
            this._collectUploadUrlCandidates(input.href, out, depth + 1);
        }
        return out;
    }

    async _resolveUploadFinalUrl(response, fallbackFilename) {
        const fallbackUrl = this._normalizeUploadedBackgroundUrl(`/backgrounds/${fallbackFilename || ''}`);
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (e) {
            payload = null;
        }

        const candidates = this._collectUploadUrlCandidates([
            payload?.url,
            payload?.file,
            payload?.filename,
            payload?.name,
            payload?.data?.url,
            payload?.data?.file,
            payload?.data?.filename,
            payload?.data?.name,
            payload?.result?.url,
            payload?.result?.file,
            payload?.result?.filename,
            payload?.result?.name,
            payload?.path,
            payload?.data?.path,
            payload?.result?.path
        ]);

        for (const candidate of candidates) {
            const resolved = this._normalizeUploadedBackgroundUrl(candidate);
            if (resolved) return resolved;
        }
        return fallbackUrl;
    }

    async _readUploadErrorDetail(response) {
        const trimDetail = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);

        try {
            const payload = await response.clone().json();
            const fromPayload = trimDetail(payload?.error || payload?.message || payload?.msg || payload?.detail);
            if (fromPayload) return fromPayload;
        } catch (e) {
            // ignore json parse errors and fallback to plain text
        }

        try {
            const text = trimDetail(await response.clone().text());
            if (text) return text;
        } catch (e) {
            // ignore body read errors
        }

        return '';
    }

    async _uploadHoneyGeneratedImageDataUrl(dataUrl, { hostName = '', seed = '', oldImageUrl = '' } = {}) {
        const safeDataUrl = String(dataUrl || '').trim();
        if (!safeDataUrl.startsWith('data:image/')) return safeDataUrl;
        const blobResp = await fetch(safeDataUrl);
        const blob = await blobResp.blob();
        if (!blob || blob.size <= 0) throw new Error('生成图片为空，无法保存');
        const safeHost = `h${this._simpleHash(String(hostName || 'live')).toString(36)}`;
        const uniqueSeed = seed === '' || seed == null || String(seed) === '-1'
            ? `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            : seed;
        const safeSeed = String(uniqueSeed).replace(/[^\w-]+/g, '').slice(0, 48);
        const uploadedUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(blob, `honey_nai_${safeHost}_${safeSeed}`);
        if (!uploadedUrl) throw new Error('图片上传管理器未初始化');
        if (oldImageUrl && oldImageUrl !== uploadedUrl && this._isManagedBackgroundUrl(oldImageUrl)) {
            window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldImageUrl, { quiet: true, skipIfReferenced: true });
        }
        return uploadedUrl;
    }

    _loadCSS() {
        const cssHref = this._getHoneyAssetUrl('honey.css?v=20260606-ticker-once');
        const styleId = 'honey-css-inline';
        const linkId = 'honey-css-link';
        const existingLink = document.getElementById(linkId);
        if (existingLink?.getAttribute('href') === cssHref) {
            this.cssPromise = Promise.resolve();
            return;
        }
        const existing = document.getElementById(styleId);
        if (existing?.getAttribute('data-source') === cssHref) {
            this.cssPromise = Promise.resolve();
            return;
        }

        existingLink?.remove();
        const linkEl = document.createElement('link');
        linkEl.id = linkId;
        linkEl.rel = 'stylesheet';
        linkEl.href = cssHref;
        document.head.appendChild(linkEl);

        this.cssPromise = new Promise((resolve) => {
            linkEl.addEventListener('load', resolve, { once: true });
            linkEl.addEventListener('error', (err) => {
                console.error('❌ 蜜语CSS加载失败:', err);
                resolve();
            }, { once: true });
        });
    }

    render() {
        this._cleanupTransient();
        this._syncSessionState();
        if (this.currentPage !== 'live') {
            if (this._liveBatchTimer) {
                clearTimeout(this._liveBatchTimer);
                this._liveBatchTimer = null;
            }
            this._livePendingUserLines = [];
            this._liveSendInFlight = false;
            this._isGiftPickerOpen = false;
            this.isScenePanelOpen = false;
            this._isSceneTagHistoryOpen = false;
            this._isEndCollabConfirmOpen = false;
        }
        if (this.currentPage === 'private') this.currentPage = 'mine';
        if (this.currentPage === 'settings') return this.renderSettingsPage();
        if (this.currentPage === 'live') return this.renderLivePage();
        if (this.currentPage === 'follow') return this.renderFollowPage();
        if (this.currentPage === 'history') return this.renderHistoryPage();
        if (this.currentPage === 'mine') return this.renderMinePage();
        this.renderRecommendPage();
    }

    _isCurrentHoneyView() {
        return !!document.querySelector('.phone-view-current .honey-app');
    }

    _isCurrentLiveRoot(root = null) {
        const liveRoot = root || document.querySelector('.phone-view-current .honey-page-live');
        if (!liveRoot || !liveRoot.isConnected) return false;
        if (this.currentPage !== 'live') return false;
        return !!liveRoot.closest?.('.phone-view-current');
    }

    _playLiveVideoIfCurrent(liveVideo, root = null) {
        if (!liveVideo) return false;
        const liveRoot = root || liveVideo.closest?.('.honey-page-live');
        if (!this._isCurrentLiveRoot(liveRoot)) {
            liveVideo.pause?.();
            return false;
        }
        const playPromise = liveVideo.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(error => {
                if (!liveVideo.isConnected || !this._isCurrentLiveRoot(liveRoot)) return;
                console.warn('直播视频自动播放被浏览器拦截:', error);
            });
        }
        return true;
    }

    _refreshHoneyImageGenerationView(sourceRoot = null) {
        if (!this._isCurrentHoneyView()) return false;
        const isCurrentLiveRoot = this.currentPage === 'live'
            && sourceRoot
            && sourceRoot.isConnected
            && !!sourceRoot.closest?.('.phone-view-current');
        if (isCurrentLiveRoot) {
            this._refreshLivePageDom({ sourceRoot, scene: this.currentSceneData });
        } else {
            this.render();
        }
        return true;
    }

    _getRecommendRefreshHintText() {
        return '回推荐页下拉刷新生成剧情。';
    }

    _getUserLiveIdleHintText() {
        return '输入开场白后回车开播。未点击结束直播前，这场直播会一直保留。';
    }

    buildRecommendListHtml() {
        const indexedTopics = (Array.isArray(this.recommendTopics) ? this.recommendTopics : [])
            .map((item, idx) => ({
                item: (item && typeof item === 'object') ? item : {},
                idx
            }));
        const todayEntry = indexedTopics.find(entry => !!entry.item.isTodayRecommend) || indexedTopics[0] || null;
        const otherEntries = indexedTopics.filter(entry => !todayEntry || entry.idx !== todayEntry.idx);

        const buildRegularHotItem = (item, idx, rank) => {
            const safeTitle = this._escapeHtml(item.title || '未命名主题');
            const rawHost = String(item.host || '神秘主播').trim() || '神秘主播';
            const safeHost = this._escapeHtml(rawHost);
            const safeViewers = this._escapeHtml(item.viewers || '0');
            const tagText = String(item.tag || '').replace(/^(?:tag|标签)\s*[：:]\s*/i, '').trim();
            const tagHtml = tagText
                ? `<span class="honey-hot-category">${this._escapeHtml(tagText)}</span>`
                : '';
            return `
                <div class="honey-hot-item honey-hot-item-compact" data-topic-index="${idx}">
                    <div class="honey-hot-rank ${rank <= 3 ? 'top3' : ''}">${rank}</div>
                    <div class="honey-hot-info">
                        <div class="honey-hot-title-row">
                            <div class="honey-hot-title">${safeTitle}</div>
                        </div>
                        <div class="honey-hot-meta">
                            <span class="honey-hot-host">${safeHost}</span>
                            ${tagHtml}
                            <span class="honey-hot-online">${safeViewers} 在线</span>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right honey-hot-arrow"></i>
                </div>
            `;
        };

        const todayHtml = (() => {
            if (!todayEntry) return '';
            const item = todayEntry.item || {};
            const idx = todayEntry.idx;
            const safeTitle = this._escapeHtml(item.title || '今日推荐直播');
            const rawHost = String(item.host || '神秘主播').trim() || '神秘主播';
            const safeHost = this._escapeHtml(rawHost);
            const safeViewers = this._escapeHtml(item.viewers || '0');
            const safeIntro = this._escapeHtml(item.intro || '点击进入直播间查看详情');
            const tagText = String(item.tag || '').replace(/^(?:tag|标签)\s*[：:]\s*/i, '').trim();
            const tagHtml = tagText
                ? `<span class="honey-today-category">${this._escapeHtml(tagText)}</span>`
                : '';
            return `
                <div class="honey-hot-section-title">今日推荐</div>
                <div class="honey-hot-item honey-today-card" data-topic-index="${idx}">
                    <div class="honey-today-head">
                        <span class="honey-today-badge">TODAY</span>
                        ${tagHtml}
                    </div>
                    <div class="honey-today-title">${safeTitle}</div>
                    <div class="honey-today-intro">${safeIntro}</div>
                    <div class="honey-today-meta">
                        <span class="honey-hot-host">${safeHost}</span>
                        <span class="honey-hot-online">${safeViewers} 在线</span>
                        <i class="fa-solid fa-chevron-right honey-hot-arrow"></i>
                    </div>
                </div>
            `;
        })();

        const otherHtml = otherEntries.length > 0
            ? `
                <div class="honey-hot-section-title">其他推荐</div>
                ${otherEntries.map((entry, idx) => buildRegularHotItem(entry.item, entry.idx, idx + 1)).join('')}
            `
            : '';

        const fallbackHtml = `
            <div class="honey-hot-item is-empty" style="cursor: default;">
                <div class="honey-hot-rank">-</div>
                <div class="honey-hot-info">
                    <div class="honey-hot-title">暂无预设推荐</div>
                    <div class="honey-hot-heat">从上方标签栏下拉松手可刷新生成蜜语</div>
                </div>
            </div>
        `;

        return indexedTopics.length > 0
            ? `${todayHtml}${otherHtml}`
            : fallbackHtml;
    }

    renderRecommendPage() {
        const bgVideoUrlRaw = this.app.honeyData?.getRecommendBgVideo?.();
        const bgVideoUrl = typeof bgVideoUrlRaw === 'string' ? bgVideoUrlRaw.trim() : '';
        const hasBgVideo = !!bgVideoUrl;
        const videoHtml = hasBgVideo
            ? `<video id="honey-bg-video-el" src="${this._escapeHtml(bgVideoUrl)}" class="honey-bg-video" autoplay loop muted playsinline webkit-playsinline preload="metadata"></video>`
            : '';
        const listHtml = this.buildRecommendListHtml();

        const html = `
            <div class="honey-app honey-page-recommend">
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title">❤️</div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${hasBgVideo ? `<button class="honey-icon-btn" id="honey-bg-sound-btn" title="开启/关闭声音" style="font-size: 15px;"><i class="fa-solid fa-volume-xmark"></i></button>` : ''}
                        <button class="honey-icon-btn" id="honey-recommend-search-btn" title="搜索推荐" aria-label="搜索推荐"><i class="fa-solid fa-magnifying-glass"></i></button>
                        <button class="honey-icon-btn" id="honey-settings-btn" title="蜜语设置"><i class="fa-solid fa-gear"></i></button>
                    </div>
                </div>

                <div class="honey-tabs">
                    <div class="honey-tab active" id="honey-tab-recommend">推荐</div>
                    <div class="honey-tab" id="honey-tab-live">直播</div>
                    <div class="honey-tab" id="honey-tab-follow">关注</div>
                    <div class="honey-tab" id="honey-tab-mine">私密</div>
                </div>

                <div class="honey-content ${hasBgVideo ? 'has-bg-video' : ''}">
                    ${videoHtml}
                    <div class="honey-recommend-wrap ${hasBgVideo ? 'has-bg-video' : ''}">
                        <div class="honey-pull-refresh-indicator" id="honey-pull-refresh-indicator">
                            <div class="honey-pull-refresh-inner" id="honey-pull-refresh-inner"></div>
                        </div>
                        <div class="honey-hot-list" id="honey-hot-list">
                            ${listHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'honey-main');
        this._applyPhoneChromeTheme();
        this.bindRecommendEvents();
    }

    _bindRecommendTopicEntries(root = null) {
        const currentRoot = root || document.querySelector('.phone-view-current .honey-page-recommend') || document.querySelector('.honey-page-recommend');
        if (!currentRoot) return;

        currentRoot.querySelectorAll('.honey-hot-item').forEach(el => {
            if (el.dataset.honeyTopicBound === '1') return;
            el.dataset.honeyTopicBound = '1';
            el.addEventListener('click', () => {
                if (!el.dataset.topicIndex) return;
                const idx = parseInt(el.dataset.topicIndex || '0', 10);
                const topic = this.recommendTopics[idx] || this.recommendTopics[0] || this._getFallbackTopic();
                this._silenceRecommendSpeaker();
                this.enterLiveFromTopic(topic, { autoGenerateIfMissing: false, backTarget: 'recommend' });
            });
        });
    }

    refreshRecommendPageContent({ resetScroll = false } = {}) {
        const currentRoot = document.querySelector('.phone-view-current .honey-page-recommend') || document.querySelector('.honey-page-recommend');
        const wrap = currentRoot?.querySelector('.honey-recommend-wrap');
        const list = currentRoot?.querySelector('#honey-hot-list');
        if (!wrap || !list) {
            if (this.currentPage === 'recommend') this.renderRecommendPage();
            return;
        }

        const previousScrollTop = resetScroll ? 0 : wrap.scrollTop;
        list.innerHTML = this.buildRecommendListHtml();
        wrap.scrollTop = previousScrollTop;
        this._bindRecommendTopicEntries(currentRoot);
        this._syncRecommendRefreshIndicatorByState();
    }

    async handleRecommendRefresh(options = {}) {
        if (!this._isHoneyLiveEnabled()) {
            this.app.phoneShell.showNotification('蜜语已关闭', '请先在设置中开启蜜语功能', '⚠️');
            return;
        }
        if (this._isGeneratingScene || this._recommendRefreshStatus === 'loading') return;

        const recommendSearchKeyword = String(options?.keyword || options?.recommendSearchKeyword || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
        const previousRecommendTopics = this._cloneRecommendTopicsForPrompt(this.recommendTopics);
        clearTimeout(this._recommendRefreshTimer);
        this._recommendRefreshStatus = 'loading';
        this._syncRecommendRefreshIndicatorByState();

        try {
            const aiData = await this.app.honeyData.generateLiveScene(null, {
                requestMode: 'from_scratch',
                previousRecommendTopics,
                recommendSearchKeyword
            });

            const nextRecommendTopics = this._normalizeRecommendTopics(aiData?.recommendTopics);
            if (!Array.isArray(nextRecommendTopics) || nextRecommendTopics.length === 0) {
                throw new Error('AI 未返回有效的蜜语推荐列表');
            }

            this.recommendTopics = nextRecommendTopics;
            this.app?.honeyData?.saveRecommendTopics?.(this.recommendTopics);

            const directTopic = this._getDirectLiveTopic();
            const directTopicKey = String(directTopic?._topicKey || 'topic_direct_live').trim() || 'topic_direct_live';
            const directTopicTitle = String(aiData?.title || directTopic?.title || '直播间').trim() || '直播间';
            const nextDirectScene = {
                ...this._buildBaseScene(directTopic, directTopicTitle, directTopicKey),
                ...(aiData && typeof aiData === 'object' ? aiData : {}),
                title: directTopicTitle,
                _topicTitle: directTopicTitle,
                _topicKey: directTopicKey
            };
            this.app?.honeyData?.saveTopicScene?.(directTopicKey, nextDirectScene, directTopicTitle);

            this._recommendRefreshStatus = 'success';
            if (this.currentPage === 'recommend') {
                this.refreshRecommendPageContent({ resetScroll: true });
            } else {
                this._syncRecommendRefreshIndicatorByState();
            }
            this.app.phoneShell.showNotification('蜜语', recommendSearchKeyword ? `已按「${recommendSearchKeyword}」刷新蜜语` : '已刷新全局蜜语内容', '✅');
        } catch (err) {
            console.error('蜜语推荐刷新失败:', err);
            this._recommendRefreshStatus = 'error';
            this._syncRecommendRefreshIndicatorByState();
            this.app.phoneShell.showNotification('错误', err?.message || String(err), '❌');
        } finally {
            clearTimeout(this._recommendRefreshTimer);
            this._recommendRefreshTimer = setTimeout(() => {
                this._recommendRefreshStatus = 'idle';
                this._syncRecommendRefreshIndicatorByState();
            }, this._recommendRefreshStatus === 'success' ? 1200 : 1600);
        }
    }

    _cloneRecommendTopicsForPrompt(topics) {
        if (!Array.isArray(topics)) return [];
        return topics
            .filter(item => item && typeof item === 'object')
            .slice(0, 12)
            .map(item => ({
                title: String(item.title || '').trim(),
                host: String(item.host || item.name || '').trim(),
                category: String(item.category || item.recommendCategory || '').trim(),
                intro: this._hasMeaningfulSceneDescription(item.intro || item.description || '')
                    ? String(item.intro || item.description || '').trim()
                    : '',
                heat: String(item.heat || item.viewers || item.playCount || '').trim()
            }))
            .filter(item => item.title || item.host || item.intro);
    }

    _openRecommendSearchModal() {
        const root = document.querySelector('.phone-view-current .honey-page-recommend') || document.querySelector('.honey-page-recommend');
        if (!root) return;
        root.querySelector('#honey-recommend-search-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'honey-recommend-search-modal';
        modal.className = 'honey-search-modal';
        modal.innerHTML = `
            <button class="honey-search-backdrop" type="button" data-action="close-search" aria-label="关闭搜索"></button>
            <div class="honey-search-panel" role="dialog" aria-modal="true" aria-label="搜索蜜语推荐">
                <div class="honey-search-head">
                    <div class="honey-search-title">搜索推荐</div>
                    <button class="honey-search-close" type="button" data-action="close-search" aria-label="关闭搜索">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <input class="honey-search-input" id="honey-recommend-search-input" type="text" maxlength="80" placeholder="输入关键词，例如：雨夜、乐队、办公室">
                <div class="honey-search-actions">
                    <button class="honey-search-btn is-secondary" type="button" data-action="close-search">取消</button>
                    <button class="honey-search-btn is-primary" type="button" data-action="submit-search">确定</button>
                </div>
            </div>
        `;
        root.appendChild(modal);

        const input = modal.querySelector('#honey-recommend-search-input');
        const close = () => modal.remove();
        const submit = () => {
            const keyword = String(input?.value || '').replace(/\s+/g, ' ').trim();
            if (!keyword) {
                input?.focus?.();
                return;
            }
            close();
            this.handleRecommendRefresh({ keyword });
        };

        modal.querySelectorAll('[data-action="close-search"]').forEach(el => {
            el.addEventListener('click', close);
        });
        modal.querySelector('[data-action="submit-search"]')?.addEventListener('click', submit);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });
        setTimeout(() => input?.focus?.(), 30);
    }

    _bindRecommendPullRefresh() {
        const root = document.querySelector('.phone-view-current .honey-page-recommend') || document.querySelector('.honey-page-recommend');
        if (!root) return;

        const triggerArea = root.querySelector('.honey-tabs');
        const scrollArea = root.querySelector('.honey-recommend-wrap');
        if (!triggerArea || !scrollArea) return;
        if (triggerArea.dataset.honeyPullBound === '1') return;
        triggerArea.dataset.honeyPullBound = '1';

        const triggerThreshold = 56;
        const maxPull = 92;
        let holdTimer = null;
        let pressing = false;
        let longPressReady = false;
        let pullDistance = 0;
        let startX = 0;
        let startY = 0;
        let pressType = '';
        let previousUserSelect = '';

        const canPull = () => (
            this.currentPage === 'recommend'
            && scrollArea.scrollTop <= 2
            && this._recommendRefreshStatus !== 'loading'
            && !this._isGeneratingScene
        );

        const clearHoldTimer = () => {
            if (!holdTimer) return;
            clearTimeout(holdTimer);
            holdTimer = null;
        };

        const resetState = () => {
            clearHoldTimer();
            pressing = false;
            longPressReady = false;
            pullDistance = 0;
            if (pressType === 'mouse') {
                document.body.style.userSelect = previousUserSelect || '';
                previousUserSelect = '';
            }
            pressType = '';
        };

        const startPress = (clientX, clientY, type) => {
            if (!canPull()) return false;
            pressing = true;
            longPressReady = false;
            pullDistance = 0;
            pressType = type;
            startX = clientX;
            startY = clientY;

            if (type === 'mouse') {
                previousUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
            }

            clearHoldTimer();
            holdTimer = setTimeout(() => {
                if (!pressing || !canPull()) return;
                longPressReady = true;
                this._setRecommendPullHint(18, '继续下拉刷新蜜语', false);
            }, 180);
            return true;
        };

        const movePress = (clientX, clientY, e) => {
            if (!pressing) return;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                resetState();
                this._syncRecommendRefreshIndicatorByState();
                return;
            }

            if (!longPressReady || deltaY <= 0) return;

            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setRecommendPullHint(
                pullDistance,
                ready ? '松手刷新蜜语' : '下拉刷新蜜语',
                ready
            );

            if (e?.cancelable) e.preventDefault();
        };

        const endPress = () => {
            const shouldTrigger = pressing && longPressReady && pullDistance >= triggerThreshold;
            resetState();
            if (shouldTrigger) {
                this.handleRecommendRefresh();
            } else {
                this._syncRecommendRefreshIndicatorByState();
            }
        };

        const onTouchStart = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY, 'touch');
        };
        const onTouchMove = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            movePress(e.touches[0].clientX, e.touches[0].clientY, e);
        };
        const onTouchEnd = () => {
            if (pressType !== 'touch') return;
            endPress();
        };

        let removeMouseGlobalListeners = null;
        const addMouseGlobalListeners = () => {
            const onMouseMove = (e) => {
                if (pressType !== 'mouse') return;
                movePress(e.clientX, e.clientY, e);
            };
            const onMouseUp = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };
            const onWindowBlur = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onWindowBlur);

            removeMouseGlobalListeners = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                window.removeEventListener('blur', onWindowBlur);
                removeMouseGlobalListeners = null;
            };
        };

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!startPress(e.clientX, e.clientY, 'mouse')) return;
            e.preventDefault();
            addMouseGlobalListeners();
        };

        triggerArea.addEventListener('touchstart', onTouchStart, { passive: true });
        triggerArea.addEventListener('touchmove', onTouchMove, { passive: false });
        triggerArea.addEventListener('touchend', onTouchEnd);
        triggerArea.addEventListener('touchcancel', onTouchEnd);
        triggerArea.addEventListener('mousedown', onMouseDown);
    }

    _setRecommendPullHint(height, text, ready = false) {
        const wrap = document.getElementById('honey-pull-refresh-indicator');
        const inner = document.getElementById('honey-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('loading', 'success', 'error');
        wrap.classList.toggle('ready', !!ready);
        wrap.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${text}`;
    }

    _syncRecommendRefreshIndicatorByState() {
        const wrap = document.getElementById('honey-pull-refresh-indicator');
        const inner = document.getElementById('honey-pull-refresh-inner');
        if (!wrap || !inner) return;

        wrap.classList.remove('ready', 'loading', 'success', 'error');

        if (this._recommendRefreshStatus === 'loading') {
            wrap.classList.add('loading');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在刷新蜜语...';
            return;
        }

        if (this._recommendRefreshStatus === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check"></i> 蜜语已刷新';
            return;
        }

        if (this._recommendRefreshStatus === 'error') {
            wrap.classList.add('error');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 刷新失败';
            return;
        }

        wrap.style.height = '0px';
        inner.innerHTML = '';
    }

    _resolveLivePullRefreshElements(sourceRoot = null) {
        const liveRoot = this._getLiveRoot(sourceRoot);
        if (!liveRoot) return { wrap: null, inner: null };
        return {
            wrap: liveRoot.querySelector('#honey-live-pull-refresh-indicator'),
            inner: liveRoot.querySelector('#honey-live-pull-refresh-inner')
        };
    }

    _setLivePullHint(height, text, ready = false, sourceRoot = null) {
        const { wrap, inner } = this._resolveLivePullRefreshElements(sourceRoot);
        if (!wrap || !inner) return;

        wrap.classList.remove('loading', 'success', 'error');
        wrap.classList.add('pulling');
        wrap.classList.toggle('ready', !!ready);
        wrap.style.height = `${Math.max(0, height)}px`;
        inner.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${text}`;
    }

    _syncLiveRefreshIndicatorByState(sourceRoot = null) {
        const { wrap, inner } = this._resolveLivePullRefreshElements(sourceRoot);
        if (!wrap || !inner) return;

        wrap.classList.remove('ready', 'pulling', 'loading', 'success', 'error');

        if (this._liveRefreshStatus === 'loading') {
            wrap.classList.add('loading');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在刷新当前直播...';
            return;
        }

        if (this._liveRefreshStatus === 'success') {
            wrap.classList.add('success');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-circle-check"></i> 当前直播已刷新';
            return;
        }

        if (this._liveRefreshStatus === 'error') {
            wrap.classList.add('error');
            wrap.style.height = '40px';
            inner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 刷新失败';
            return;
        }

        wrap.style.height = '0px';
        inner.innerHTML = '';
    }

    async handleLivePullRefresh({ sourceRoot = null } = {}) {
        if (!this._isHoneyLiveEnabled()) {
            this.app.phoneShell.showNotification('蜜语已关闭', '请先在设置中开启蜜语功能', '⚠️');
            return;
        }

        const liveRoot = this._getLiveRoot(sourceRoot);
        if (!liveRoot) return;
        if (this._isUserLiveScene(this.currentSceneData || this.selectedTopic)) return;
        if (this._isGeneratingScene || this._liveRefreshStatus === 'loading') return;

        clearTimeout(this._liveRefreshTimer);
        this._liveRefreshStatus = 'loading';
        this._syncLiveRefreshIndicatorByState(liveRoot);

        try {
            await this._generateCurrentTopicScene({
                resetSession: true,
                notify: false,
                sourceRoot: liveRoot,
                suppressRecommendListUpdate: true
            });
            this._liveRefreshStatus = 'success';
            this._syncLiveRefreshIndicatorByState(liveRoot);
            this.app.phoneShell.showNotification('蜜语', '当前直播内容已刷新', '✅');
        } catch (err) {
            console.error('蜜语直播下拉刷新失败:', err);
            this._liveRefreshStatus = 'error';
            this._syncLiveRefreshIndicatorByState(liveRoot);
            this.app.phoneShell.showNotification('错误', err?.message || String(err), '❌');
        } finally {
            clearTimeout(this._liveRefreshTimer);
            this._liveRefreshTimer = setTimeout(() => {
                this._liveRefreshStatus = 'idle';
                this._syncLiveRefreshIndicatorByState(liveRoot);
            }, this._liveRefreshStatus === 'success' ? 1200 : 1600);
        }
    }

    _bindLivePullRefresh(sourceRoot = null, isUserLive = false) {
        const root = this._getLiveRoot(sourceRoot);
        if (!root || isUserLive) return;

        const triggerArea = root.querySelector('.honey-tabs');
        if (!triggerArea) return;
        if (triggerArea.dataset.honeyLivePullBound === '1') return;
        triggerArea.dataset.honeyLivePullBound = '1';

        const triggerThreshold = 56;
        const maxPull = 92;
        let holdTimer = null;
        let pressing = false;
        let longPressReady = false;
        let pullDistance = 0;
        let startX = 0;
        let startY = 0;
        let pressType = '';
        let previousUserSelect = '';

        const canPull = () => (
            this.currentPage === 'live'
            && !this._isUserLiveScene(this.currentSceneData || this.selectedTopic)
            && this._liveRefreshStatus !== 'loading'
            && !this._isGeneratingScene
        );

        const clearHoldTimer = () => {
            if (!holdTimer) return;
            clearTimeout(holdTimer);
            holdTimer = null;
        };

        const resetState = () => {
            clearHoldTimer();
            pressing = false;
            longPressReady = false;
            pullDistance = 0;
            if (pressType === 'mouse') {
                document.body.style.userSelect = previousUserSelect || '';
                previousUserSelect = '';
            }
            pressType = '';
        };

        const startPress = (clientX, clientY, type) => {
            if (!canPull()) return false;
            pressing = true;
            longPressReady = false;
            pullDistance = 0;
            pressType = type;
            startX = clientX;
            startY = clientY;

            if (type === 'mouse') {
                previousUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
            }

            clearHoldTimer();
            holdTimer = setTimeout(() => {
                if (!pressing || !canPull()) return;
                longPressReady = true;
                this._setLivePullHint(18, '继续下拉刷新当前直播', false, root);
            }, 180);
            return true;
        };

        const movePress = (clientX, clientY, e) => {
            if (!pressing) return;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
                resetState();
                this._syncLiveRefreshIndicatorByState(root);
                return;
            }

            if (!longPressReady || deltaY <= 0) return;

            pullDistance = Math.min(maxPull, Math.round(deltaY * 0.55));
            const ready = pullDistance >= triggerThreshold;
            this._setLivePullHint(
                pullDistance,
                ready ? '松手刷新当前直播' : '下拉刷新当前直播',
                ready,
                root
            );

            if (e?.cancelable) e.preventDefault();
        };

        const endPress = () => {
            const shouldTrigger = pressing && longPressReady && pullDistance >= triggerThreshold;
            resetState();
            if (shouldTrigger) {
                this.handleLivePullRefresh({ sourceRoot: root });
            } else {
                this._syncLiveRefreshIndicatorByState(root);
            }
        };

        const onTouchStart = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY, 'touch');
        };
        const onTouchMove = (e) => {
            if (!e.touches || e.touches.length === 0) return;
            movePress(e.touches[0].clientX, e.touches[0].clientY, e);
        };
        const onTouchEnd = () => {
            if (pressType !== 'touch') return;
            endPress();
        };

        let removeMouseGlobalListeners = null;
        const addMouseGlobalListeners = () => {
            const onMouseMove = (e) => {
                if (pressType !== 'mouse') return;
                movePress(e.clientX, e.clientY, e);
            };
            const onMouseUp = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };
            const onWindowBlur = () => {
                if (pressType !== 'mouse') return;
                if (removeMouseGlobalListeners) removeMouseGlobalListeners();
                endPress();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            window.addEventListener('blur', onWindowBlur);

            removeMouseGlobalListeners = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                window.removeEventListener('blur', onWindowBlur);
                removeMouseGlobalListeners = null;
            };
        };

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (!startPress(e.clientX, e.clientY, 'mouse')) return;
            e.preventDefault();
            addMouseGlobalListeners();
        };

        triggerArea.addEventListener('touchstart', onTouchStart, { passive: true });
        triggerArea.addEventListener('touchmove', onTouchMove, { passive: false });
        triggerArea.addEventListener('touchend', onTouchEnd);
        triggerArea.addEventListener('touchcancel', onTouchEnd);
        triggerArea.addEventListener('mousedown', onMouseDown);
    }

    renderLivePage() {
        const activeLiveScene = (this.currentPage === 'live' && this.currentSceneData && typeof this.currentSceneData === 'object')
            ? this.currentSceneData
            : null;
        const topic = activeLiveScene || this.selectedTopic || this.recommendTopics[0] || this._getFallbackTopic();
        const honeyEnabled = this._isHoneyLiveEnabled();
        const activeTopicTitle = String(topic?._topicTitle || topic?.title || '直播间').trim();
        const activeTopicKey = String(topic?._topicKey || this._resolveTopicKey(topic, activeTopicTitle)).trim();
        if (topic && typeof topic === 'object' && !topic._topicKey) {
            topic._topicKey = activeTopicKey;
        }
        const currentSceneTopicTitle = String(this.currentSceneData?._topicTitle || this.currentSceneData?.title || '').trim();
        const currentSceneTopicKey = String(this.currentSceneData?._topicKey || '').trim();
        const isSameTopic = (!!activeTopicKey && !!currentSceneTopicKey && activeTopicKey === currentSceneTopicKey)
            || (activeTopicTitle && currentSceneTopicTitle && activeTopicTitle === currentSceneTopicTitle);

        if (!isSameTopic) {
            const hasCurrentLiveState = this.currentPage === 'live'
                && this.currentSceneData
                && typeof this.currentSceneData === 'object'
                && (
                    this._hasMeaningfulSceneDescription(this.currentSceneData.description)
                    || (Array.isArray(this.currentSceneData.comments) && this.currentSceneData.comments.length > 0)
                    || (Array.isArray(this.currentSceneData.userChats) && this.currentSceneData.userChats.length > 0)
                    || (Array.isArray(this.currentSceneData.promptTurns) && this.currentSceneData.promptTurns.length > 0)
                    || (Array.isArray(this.currentSceneData.gifts) && this.currentSceneData.gifts.length > 0)
                    || (this.currentSceneData.audienceGiftTotals && typeof this.currentSceneData.audienceGiftTotals === 'object' && Object.keys(this.currentSceneData.audienceGiftTotals).length > 0)
                );
            if (hasCurrentLiveState) {
                this.currentSceneData = {
                    ...this.currentSceneData,
                    _topicTitle: currentSceneTopicTitle || activeTopicTitle,
                    _topicKey: currentSceneTopicKey || activeTopicKey
                };
                this._persistCurrentScene();
            } else {
                const cached = this.app.honeyData?.getTopicScene?.(activeTopicKey || activeTopicTitle, activeTopicTitle);
                if (cached && typeof cached === 'object') {
                    this.currentSceneData = { ...cached, _topicTitle: activeTopicTitle, _topicKey: activeTopicKey };
                } else {
                    const lastScene = this.app.honeyData?.getLastSceneData?.();
                    const lastSceneTitle = String(lastScene?._topicTitle || lastScene?.title || '').trim();
                    const lastSceneKey = String(lastScene?._topicKey || '').trim();
                    const canRestoreLastScene = lastScene && typeof lastScene === 'object'
                        && ((activeTopicKey && lastSceneKey && activeTopicKey === lastSceneKey)
                            || (activeTopicTitle && lastSceneTitle && activeTopicTitle === lastSceneTitle));
                    this.currentSceneData = canRestoreLastScene
                        ? { ...lastScene, _topicTitle: activeTopicTitle, _topicKey: activeTopicKey || lastSceneKey }
                        : this._buildBaseScene(topic || this._getFallbackTopic(), activeTopicTitle, activeTopicKey);
                    this.currentSceneData.title = activeTopicTitle;
                    if (!canRestoreLastScene) {
                        this.currentSceneData.description = this._getRecommendRefreshHintText();
                        this.currentSceneData.comments = [];
                        this.currentSceneData.lastUserComment = '';
                        this.currentSceneData.userChats = [];
                        this.currentSceneData.promptTurns = [];
                        this.currentSceneData.gifts = [];
                        this.currentSceneData.audienceGiftTotals = {};
                        this.currentSceneData.leaderboard = [];
                        this.currentSceneData.userGiftRank = null;
                    }
                    this._persistCurrentScene();
                }
            }
        }

        const data = this.currentSceneData || {
            host: topic.host,
            title: topic.title,
            viewers: topic.viewers,
            playCount: topic.playCount,
            fans: topic.fans,
            collab: topic.collab || '无',
            collabCost: Number.parseInt(String(topic.collabCost ?? 0), 10) || 0,
            leaderboard: Array.isArray(topic.leaderboard) ? topic.leaderboard : [],
            intro: topic.intro || '',
            description: topic.description,
            comments: topic.comments || [],
            lastUserComment: String(topic?.lastUserComment || '').trim(),
            gifts: [],
            audienceGiftTotals: this._getSceneAudienceGiftTotals(topic),
            userGiftRank: (topic?.userGiftRank && typeof topic.userGiftRank === 'object') ? topic.userGiftRank : null,
            _topicTitle: activeTopicTitle,
            _topicKey: activeTopicKey
        };
        const isUserLive = this._isUserLiveScene(data) || this._isUserLiveScene(topic) || activeTopicKey === 'topic_user_live';
        const userLiveProfile = isUserLive
            ? (this.app?.honeyData?.getHoneyUserProfile?.() || {})
            : null;
        const resolvedHostName = String(
            isUserLive
                ? (userLiveProfile?.nickname || data.host || '主播')
                : (data.host || '')
        ).trim() || '主播';
        const resolvedFans = String(
            isUserLive
                ? (data.fans || userLiveProfile?.followers || data.viewers || '0')
                : (data.fans || '0')
        ).trim() || '0';
        const displayFans = this._formatAudienceCountDisplay(resolvedFans);
        const displayViewers = this._formatAudienceCountDisplay(data.viewers || '0');
        const safeHostName = resolvedHostName;
        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const isHostFollowed = !isUserLive && followedHosts.some(item => this._isSameHostName(item?.name, safeHostName));
        this._ensureAvatarManifestLoaded();
        const avatarSeedData = isUserLive ? { ...data, host: resolvedHostName } : data;
        const preferredAudienceGender = isUserLive
            ? ((String(userLiveProfile?.gender || 'female').trim().toLowerCase() === 'male') ? 'female' : 'male')
            : '';
        const avatarSetBase = this._buildLiveAvatarSet(avatarSeedData, { preferredAudienceGender });
        const avatarSet = isUserLive
            ? {
                ...avatarSetBase,
                hostAvatarUrl: this._getHoneyDisplayUserAvatar(userLiveProfile) || avatarSetBase.hostAvatarUrl
            }
            : avatarSetBase;
        const hostAvatarStyle = avatarSet.hostAvatarUrl
            ? ` style="${this._buildAvatarInlineStyle(avatarSet.hostAvatarUrl)}"`
            : '';
        const audienceAvatarHtml = [0, 1, 2].map((idx) => {
            const cls = `a${idx + 1}`;
            const avatarUrl = avatarSet.audienceAvatarUrls[idx] || '';
            const avatarStyle = avatarUrl
                ? ` style="${this._buildAvatarInlineStyle(avatarUrl)}"`
                : '';
            const photoClass = avatarUrl ? ' is-photo' : '';
            return `<span class="honey-meta-audience-avatar ${cls}${photoClass}"${avatarStyle}></span>`;
        }).join('');
        const liveTitleText = this._sanitizeLiveRoomTitle(data.title || activeTopicTitle || '直播间');
        const isPrivateLive = this._isPrivateLiveScene(data);
        const liveTitleDisplayText = isPrivateLive && !/^【私密中】/.test(liveTitleText)
            ? `【私密中】${liveTitleText}`
            : liveTitleText;
        const naiPrompt = this._resolveSceneNaiPrompt(data);
        const imageStatus = String(data.imageGenerationStatus || '').trim();
        const generatedImageUrl = String(data.naiImageUrl || data.generatedImageUrl || data.imageUrl || '').trim();
        const liveVideoUrl = generatedImageUrl ? '' : this._buildLiveVideoUrl(data);
        const liveVideoHtml = liveVideoUrl
            ? `<video id="honey-live-video-el" src="${this._escapeHtml(liveVideoUrl)}" class="honey-live-video" loop muted playsinline webkit-playsinline preload="metadata"></video>`
            : '';
        const liveGlassHtml = generatedImageUrl
            ? ''
            : `<div class="honey-nai-glass" style="${liveVideoUrl ? 'backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(0,0,0,0.1);' : ''}"></div>`;
        const generatedImageHtml = generatedImageUrl
            ? `<img class="honey-nai-generated-image" src="${this._escapeHtml(generatedImageUrl)}" alt="">`
            : '';
        const imageButtonLabel = imageStatus === 'loading'
            ? '生成中...'
            : (generatedImageUrl ? '重新生成图片' : (naiPrompt ? '生成直播图片' : '等待 NAI 提示词'));
        const imageButtonIcon = imageStatus === 'loading'
            ? 'fa-spinner fa-spin'
            : (generatedImageUrl ? 'fa-rotate' : (naiPrompt ? 'fa-wand-magic-sparkles' : 'fa-lock'));
        const imageButtonDisabled = imageStatus === 'loading' || !naiPrompt;
        const imageStatusHtml = imageStatus === 'failed' && data.imageGenerationError
            ? `<div class="honey-nai-status is-error">${this._escapeHtml(data.imageGenerationError)}</div>`
            : '';
        const collabNick = this._normalizeLiveCollabName(data.collab);
        const collabCost = Math.max(0, Number.parseInt(String(data.collabCost ?? 0), 10) || 0);
        const collabLabel = collabNick === '无' ? '申请联播' : `联播：${collabNick}`;
        const collabInfo = this._normalizeLiveCollabRequest(data?.collabRequestInfo || null);
        const collabMetaBrief = collabInfo?.hostType
            ? String(collabInfo.hostType).trim().slice(0, 6)
            : String(collabInfo?.rankHint || '').trim().replace(/^榜单\s*/i, '').slice(0, 6);
        const userLiveCollabLabel = collabNick === '无'
            ? '暂无联播'
            : `联播：${collabNick}${collabMetaBrief ? `·${collabMetaBrief}` : ''}`;
        const collabTitleText = collabNick === '无'
            ? '当前暂无联播'
            : `当前联播：${collabNick}${collabInfo?.hostType ? `｜${collabInfo.hostType}` : ''}${collabInfo?.rankHint ? `｜${collabInfo.rankHint}` : ''}`;
        const rankExpanded = !!this._isLiveRankExpanded;
        const honeyNickname = isUserLive ? '' : (this.app?.honeyData?.getHoneyUserNickname?.() || '你');
        const audienceGiftTotals = this._getSceneAudienceGiftTotals(data);
        const userGiftTotal = Math.max(0, Math.round(Number(audienceGiftTotals[this._normalizeLeaderboardName(honeyNickname)] || 0) || 0));
        const mergedLeaderboard = isUserLive
            ? this._buildLeaderboardFromAudienceTotals(audienceGiftTotals)
            : this._buildMergedLeaderboardWithUser(data?.leaderboard, honeyNickname, userGiftTotal);
        const leaderboardItems = mergedLeaderboard.top3;
        const userRankItem = mergedLeaderboard.userRank;
        const safeHoneyNickname = this._normalizeLeaderboardName(honeyNickname);
        const isUserInTop3 = leaderboardItems.some(item => this._normalizeLeaderboardName(item?.name || '') === safeHoneyNickname);
        const shouldShowUserRankRow = !!userRankItem && !isUserInTop3 && (Number(userRankItem.rank) > 3 || !Number.isFinite(Number(userRankItem.rank)));
        const leaderboardRowsHtml = leaderboardItems.length > 0
            ? leaderboardItems.map(item => `
                <div class="honey-live-rank-row">
                    <span class="honey-live-rank-index">#${item.rank}</span>
                    <span class="honey-live-rank-name">${this._escapeHtml(item.name)}</span>
                    <span class="honey-live-rank-coins">${this._escapeHtml(item.coins ? ((/(?:金币|金豆|币|[gG])$/.test(item.coins) ? item.coins : `${item.coins}金币`)) : '--')}</span>
                </div>
            `).join('')
            : '<div class="honey-live-rank-empty">暂无打榜</div>';
        const userRankHtml = shouldShowUserRankRow
            ? `
                <div class="honey-live-rank-row is-self">
                    <span class="honey-live-rank-index">#N</span>
                    <span class="honey-live-rank-name">${this._escapeHtml(userRankItem.name)}</span>
                    <span class="honey-live-rank-coins">${this._escapeHtml(userRankItem.coins)}</span>
                </div>
            `
            : '';
        const introTickerText = this._getLiveTickerIntro(data);
        const mixedFeed = this._buildLiveTickerFeed(data);
        const visibleRows = 3;
        const shouldScrollGifts = mixedFeed.length > visibleRows;
        const giftRowStep = 34;
        const giftListStyle = shouldScrollGifts
            ? `style="--honey-gift-visible-rows:${visibleRows};--honey-gift-row-height:${giftRowStep}px;--honey-gift-scroll-duration:${Math.max(10, mixedFeed.length * 2.6)}s;"`
            : `style="--honey-gift-visible-rows:${visibleRows};--honey-gift-row-height:${giftRowStep}px;"`;

        const introHtml = `
            <div class="honey-live-intro-top" id="honey-live-intro-top" style="${introTickerText ? '' : 'display:none;'}">
                ${introTickerText ? `
                <div class="honey-live-gift-item honey-live-gift-intro">
                    <span class="honey-gift-icon">🔔</span>
                    <span class="honey-live-gift-text-wrap" id="honey-intro-ticker-wrap">
                        <span class="honey-live-gift-text-track" id="honey-intro-ticker-track">
                            <span class="honey-live-gift-text" id="honey-intro-ticker-text">简介：${this._escapeHtml(introTickerText)}</span>
                            <span class="honey-live-gift-text honey-live-gift-text-clone" id="honey-intro-ticker-clone" aria-hidden="true"></span>
                        </span>
                    </span>
                </div>
                ` : ''}
            </div>
        `;

        const giftRows = mixedFeed.map(item => {
            if (item.type === 'comment') {
                return `
                    <div class="honey-live-gift-item honey-live-gift-comment">
                        <span class="honey-live-comment-rank">${this._escapeHtml(item.rank || '热评')}</span>
                        <span class="honey-live-comment-line">
                            <span class="honey-live-comment-user">${this._escapeHtml(item.user || '匿名')}</span>：<span class="honey-live-comment-content">${this._escapeHtml(item.content || '')}</span>
                        </span>
                    </div>
                `;
            }
            return `
                <div class="honey-live-gift-item honey-live-gift-reward">
                    <span class="honey-live-notify-icon" aria-hidden="true">🔔</span>
                    <span class="honey-live-gift-text honey-live-gift-text-reward">${this._renderGiftRewardTextHtml(item.text)}</span>
                </div>
            `;
        }).join('');
        const giftListHtml = mixedFeed.length > 0 ? `
            <div class="honey-live-gifts-list ${shouldScrollGifts ? 'is-scrolling' : ''}" ${giftListStyle}>
                <div class="honey-live-gifts-track">
                    ${giftRows}
                </div>
            </div>
        ` : '';

        const liveGifts = `${giftListHtml}`;
        const hostActionHtml = isUserLive
            ? '<span class="honey-live-self-badge">我的直播</span>'
            : `
                <button
                    class="honey-follow-btn ${isHostFollowed ? 'is-followed' : ''}"
                    data-host-name="${this._escapeHtml(safeHostName)}"
                    data-avatar-url="${this._escapeHtml(avatarSet.hostAvatarUrl || '')}"
                >${isHostFollowed ? '已关注' : '关注'}</button>
            `;
        const collabButtonHtml = this._buildLiveCollabButtonHtml({
            isUserLive,
            collabNick,
            collabTitleText,
            userLiveCollabLabel,
            collabLabel,
            collabCost
        });
        const chatPlaceholder = honeyEnabled
            ? (isUserLive ? '输入后回车和直播间观众互动...' : '输入后回车发送弹幕...')
            : '蜜语已关闭，请在设置中开启';
        const unlockButtonHtml = isUserLive
            ? ''
            : `
                <button class="honey-unlock-btn ${generatedImageUrl ? 'is-regenerate' : ''}" id="honey-test-nai-btn" title="${this._escapeHtml(imageButtonLabel)}" ${imageButtonDisabled ? 'disabled' : ''}>
                    <i class="fa-solid ${imageButtonIcon}"></i><span class="honey-unlock-label">${this._escapeHtml(imageButtonLabel)}</span>
                </button>
            `;
        const giftButtonHtml = isUserLive
            ? ''
            : '<button class="honey-gift-btn" id="honey-gift-btn" title="送礼物"><i class="fa-solid fa-gift"></i></button>';
        const giftPickerHtml = isUserLive
            ? ''
            : `
                <div class="honey-gift-picker" id="honey-gift-picker">
                    ${this._renderGiftPickerHtml()}
                </div>
            `;
        const endLiveButtonHtml = isUserLive
            ? '<button class="honey-end-live-btn" id="honey-end-live-btn" type="button">结束直播</button>'
            : '';
        const livePullRefreshHtml = isUserLive
            ? ''
            : `
                <div class="honey-pull-refresh-indicator honey-live-pull-refresh-indicator" id="honey-live-pull-refresh-indicator">
                    <div class="honey-pull-refresh-inner" id="honey-live-pull-refresh-inner"></div>
                </div>
            `;

        const html = `
            <div class="honey-app honey-page-live is-scene-collapsed ${isUserLive ? 'is-user-live' : ''} ${this.isScenePanelOpen ? 'is-scene-modal-open' : ''}">
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title honey-meta-title honey-nav-title-live" id="honey-ui-title-top-wrap">
                        <span class="honey-meta-title-track" id="honey-ui-title-top-track">
                            <span class="honey-meta-title-text" id="honey-ui-title-top">${this._escapeHtml(liveTitleDisplayText || '直播间')}</span>
                            <span class="honey-meta-title-text honey-meta-title-text-clone" id="honey-ui-title-top-clone" aria-hidden="true"></span>
                        </span>
                        <span class="honey-live-status-dot honey-live-status-green" id="honey-live-status-dot"></span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${liveVideoUrl ? `<button class="honey-icon-btn" id="honey-live-sound-btn" title="开启/关闭声音" style="font-size: 15px;"><i class="fa-solid fa-volume-xmark"></i></button>` : ''}
                        <button class="honey-icon-btn" id="honey-settings-btn" title="蜜语设置"><i class="fa-solid fa-gear"></i></button>
                    </div>
                </div>

                <div class="honey-tabs">
                    <div class="honey-tab" id="honey-tab-recommend">推荐</div>
                    <div class="honey-tab active" id="honey-tab-live">直播</div>
                    <div class="honey-tab" id="honey-tab-follow">关注</div>
                    <div class="honey-tab" id="honey-tab-mine">私密</div>
                </div>

                <div class="honey-content">
                    ${livePullRefreshHtml}
                    <div class="honey-live-room">
                        <div class="honey-meta-row">
                            <div class="honey-meta-host">
                                <div class="honey-host-avatar${avatarSet.hostAvatarUrl ? ' is-photo' : ''}"${hostAvatarStyle}></div>
                                <div class="honey-host-info">
                                    <span class="honey-host-name" id="honey-ui-host">${this._escapeHtml(resolvedHostName)}</span>
                                    <span class="honey-host-viewers" id="honey-ui-fans">粉丝 ${this._escapeHtml(displayFans)}</span>
                                </div>
                                ${hostActionHtml}
                            </div>
                            <div class="honey-meta-stats">
                                <div class="honey-meta-audience-row">
                                    <div class="honey-meta-audience-avatars" aria-hidden="true">
                                        ${audienceAvatarHtml}
                                    </div>
                                    <span class="honey-meta-audience-online" id="honey-ui-online">${this._escapeHtml(displayViewers)} 在线</span>
                                </div>
                                <div class="honey-live-rank-mini ${rankExpanded ? 'is-expanded' : ''}" id="honey-live-rank-mini" role="button" tabindex="0" aria-expanded="${rankExpanded ? 'true' : 'false'}" title="${rankExpanded ? '点击收起榜单' : '点击展开榜单'}">
                                    <div class="honey-live-rank-title">榜单</div>
                                    <div class="honey-live-rank-list">${leaderboardRowsHtml}${userRankHtml}</div>
                                </div>
                                <div id="honey-ui-collab-wrap">${collabButtonHtml}</div>
                            </div>
                        </div>

                        <div class="honey-nai-placeholder ${generatedImageUrl ? 'has-generated-image' : ''}" style="${liveVideoUrl ? 'background: #000;' : ''}">
                            ${generatedImageHtml}
                            ${liveVideoHtml}
                            ${liveGlassHtml}
                            ${imageStatusHtml}
                        </div>

                        ${introHtml}

                        <div class="honey-live-gifts" id="honey-live-gifts">
                            ${liveGifts}
                        </div>
                    </div>

                    <div class="honey-live-bottom">
                        <div class="honey-input-bar">
                            ${unlockButtonHtml}
                            <input type="text" class="honey-chat-input" id="honey-chat-input" placeholder="${this._escapeHtml(chatPlaceholder)}" ${(honeyEnabled && !this._isGeneratingScene) ? '' : 'disabled'}>
                            <button class="honey-scene-toggle-btn" id="honey-scene-toggle-btn" title="${this.isScenePanelOpen ? '关闭剧情' : '查看剧情'}">
                                <i class="fa-solid ${this.isScenePanelOpen ? 'fa-xmark' : 'fa-align-left'}"></i>
                            </button>
                            ${endLiveButtonHtml}
                            ${giftButtonHtml}
                        </div>

                        ${giftPickerHtml}
                    </div>
                </div>

                ${this.isScenePanelOpen ? `
                <div class="honey-scene-modal" id="honey-scene-modal">
                    <button class="honey-scene-modal-backdrop" id="honey-scene-modal-backdrop" aria-label="关闭剧情弹窗"></button>
                    <div class="honey-scene-modal-card" id="honey-scene-modal-card" role="dialog" aria-modal="true" aria-label="直播实况">
                        <div class="honey-scene-modal-head">
                            <div class="honey-scene-modal-title">直播实况</div>
                            <div class="honey-scene-modal-actions">
                                <button class="honey-scene-tts-btn honey-scene-retry-btn" id="honey-scene-retry-btn" type="button" title="重新生成本轮回复" aria-label="重新生成本轮回复" ${this._canRetryLastLiveTurn() ? '' : 'disabled'}>
                                    <i class="fa-solid fa-rotate-right"></i>
                                </button>
                                <button class="honey-scene-tts-btn" id="honey-scene-tts-btn" type="button" title="播放剧情语音" aria-label="播放剧情语音">
                                    <i class="fa-solid fa-volume-high"></i>
                                </button>
                                <button class="honey-scene-tts-btn honey-scene-tag-btn" id="honey-scene-tag-history-btn" type="button" title="查看AI返回Tag" aria-label="查看AI返回Tag">
                                    <i class="fa-regular fa-file-lines"></i>
                                </button>
                                <button class="honey-scene-modal-close-btn" id="honey-scene-modal-close-btn" type="button" title="关闭剧情弹窗">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                        <div class="honey-scene-modal-desc" id="honey-ui-scene-modal">${data.description || '暂无文字描写。'}</div>
                        ${this._buildSceneTagHistoryPanelHtml(data)}
                    </div>
                </div>
                ` : ''}

                <div id="honey-live-collab-request-layer">
                    ${this._buildLiveCollabRequestModalHtml(data)}
                </div>
                <div id="honey-live-collab-end-layer">
                    ${this._buildLiveCollabEndModalHtml(data)}
                </div>
                ${this._buildLiveVisibilityModalHtml()}
            </div>
        `;

        const liveViewId = isUserLive
            ? 'honey-live-user'
            : (this._liveEntrySource === 'follow'
                ? 'honey-live-follow'
                : (this._liveEntrySource !== 'direct' ? 'honey-live-detail' : 'honey-main'));
        this.app.phoneShell.setContent(html, liveViewId);
        this._applyPhoneChromeTheme();
        this.bindLiveEvents();
        this._syncTopTitleMarquee();
        this._syncIntroTicker();
        setTimeout(() => {
            if (this.currentPage !== 'live') return;
            this._syncTopTitleMarquee();
            this._syncIntroTicker();
        }, 140);
    }

    _getLiveRoot(sourceRoot = null) {
        if (sourceRoot?.classList?.contains('honey-page-live') && sourceRoot.isConnected) return sourceRoot;
        const nestedRoot = sourceRoot?.querySelector?.('.honey-page-live');
        if (nestedRoot?.isConnected) return nestedRoot;
        return document.querySelector('.phone-view-current .honey-page-live')
            || document.querySelector('.honey-page-live');
    }

    _setLiveStatusDot(color = 'green', sourceRoot = null) {
        const root = this._getLiveRoot(sourceRoot);
        const dot = root?.querySelector?.('#honey-live-status-dot');
        if (!dot) return;
        dot.classList.remove('honey-live-status-green', 'honey-live-status-yellow', 'honey-live-status-red');
        if (color === 'red') {
            dot.classList.add('honey-live-status-red');
            return;
        }
        if (color === 'yellow') {
            dot.classList.add('honey-live-status-yellow');
            return;
        }
        dot.classList.add('honey-live-status-green');
    }

    _syncLiveStatusDot(sourceRoot = null) {
        const root = this._getLiveRoot(sourceRoot);
        const input = root?.querySelector?.('#honey-chat-input');
        const isEditing = !!input && document.activeElement === input;
        if (this._liveSendInFlight || this._isGeneratingScene) {
            this._setLiveStatusDot('red', root);
            return;
        }
        if (this._isGiftPickerOpen) {
            this._setLiveStatusDot('green', root);
            return;
        }
        if (this._liveBatchTimer && !isEditing) {
            this._setLiveStatusDot('yellow', root);
            return;
        }
        this._setLiveStatusDot('green', root);
    }

    _buildLiveLeaderboardMarkup(data, isUserLive = false) {
        const honeyNickname = isUserLive ? '' : (this.app?.honeyData?.getHoneyUserNickname?.() || '你');
        const audienceGiftTotals = this._getSceneAudienceGiftTotals(data);
        const userGiftTotal = Math.max(0, Math.round(Number(audienceGiftTotals[this._normalizeLeaderboardName(honeyNickname)] || 0) || 0));
        const mergedLeaderboard = isUserLive
            ? this._buildLeaderboardFromAudienceTotals(audienceGiftTotals)
            : this._buildMergedLeaderboardWithUser(data?.leaderboard, honeyNickname, userGiftTotal);
        const leaderboardItems = mergedLeaderboard.top3;
        const userRankItem = mergedLeaderboard.userRank;
        const safeHoneyNickname = this._normalizeLeaderboardName(honeyNickname);
        const isUserInTop3 = leaderboardItems.some(item => this._normalizeLeaderboardName(item?.name || '') === safeHoneyNickname);
        const shouldShowUserRankRow = !!userRankItem && !isUserInTop3 && (Number(userRankItem.rank) > 3 || !Number.isFinite(Number(userRankItem.rank)));
        const leaderboardRowsHtml = leaderboardItems.length > 0
            ? leaderboardItems.map(item => `
                <div class="honey-live-rank-row">
                    <span class="honey-live-rank-index">#${item.rank}</span>
                    <span class="honey-live-rank-name">${this._escapeHtml(item.name)}</span>
                    <span class="honey-live-rank-coins">${this._escapeHtml(item.coins ? ((/(?:金币|金豆|币|[gG])$/.test(item.coins) ? item.coins : `${item.coins}金币`)) : '--')}</span>
                </div>
            `).join('')
            : '<div class="honey-live-rank-empty">暂无打榜</div>';
        const userRankHtml = shouldShowUserRankRow
            ? `
                <div class="honey-live-rank-row is-self">
                    <span class="honey-live-rank-index">#N</span>
                    <span class="honey-live-rank-name">${this._escapeHtml(userRankItem.name)}</span>
                    <span class="honey-live-rank-coins">${this._escapeHtml(userRankItem.coins)}</span>
                </div>
            `
            : '';
        return `${leaderboardRowsHtml}${userRankHtml}`;
    }

    _buildLiveTickerMarkup(data) {
        const introTickerText = this._getLiveTickerIntro(data);
        const mixedFeed = this._buildLiveTickerFeed(data);
        const visibleRows = 3;
        const shouldScrollGifts = mixedFeed.length > visibleRows;
        const giftRowStep = 34;
        const giftListStyle = shouldScrollGifts
            ? `style="--honey-gift-visible-rows:${visibleRows};--honey-gift-row-height:${giftRowStep}px;--honey-gift-scroll-duration:${Math.max(10, mixedFeed.length * 2.6)}s;"`
            : `style="--honey-gift-visible-rows:${visibleRows};--honey-gift-row-height:${giftRowStep}px;"`;
        const introInnerHtml = introTickerText
            ? `
                <div class="honey-live-gift-item honey-live-gift-intro">
                    <span class="honey-gift-icon">🔔</span>
                    <span class="honey-live-gift-text-wrap" id="honey-intro-ticker-wrap">
                        <span class="honey-live-gift-text-track" id="honey-intro-ticker-track">
                            <span class="honey-live-gift-text" id="honey-intro-ticker-text">简介：${this._escapeHtml(introTickerText)}</span>
                            <span class="honey-live-gift-text honey-live-gift-text-clone" id="honey-intro-ticker-clone" aria-hidden="true"></span>
                        </span>
                    </span>
                </div>
            `
            : '';
        const giftRows = mixedFeed.map(item => {
            if (item.type === 'comment') {
                return `
                    <div class="honey-live-gift-item honey-live-gift-comment">
                        <span class="honey-live-comment-rank">${this._escapeHtml(item.rank || '热评')}</span>
                        <span class="honey-live-comment-line">
                            <span class="honey-live-comment-user">${this._escapeHtml(item.user || '匿名')}</span>：<span class="honey-live-comment-content">${this._escapeHtml(item.content || '')}</span>
                        </span>
                    </div>
                `;
            }
            return `
                <div class="honey-live-gift-item honey-live-gift-reward">
                    <span class="honey-live-notify-icon" aria-hidden="true">🔔</span>
                    <span class="honey-live-gift-text honey-live-gift-text-reward">${this._renderGiftRewardTextHtml(item.text)}</span>
                </div>
            `;
        }).join('');
        const giftListHtml = mixedFeed.length > 0 ? `
            <div class="honey-live-gifts-list ${shouldScrollGifts ? 'is-scrolling' : ''}" ${giftListStyle}>
                <div class="honey-live-gifts-track">
                    ${giftRows}
                </div>
            </div>
        ` : '';

        return {
            introInnerHtml,
            hasIntro: !!introTickerText,
            giftListHtml
        };
    }

    _refreshLivePageDom({ sourceRoot = null, scene = null } = {}) {
        if (this.currentPage !== 'live') return;
        const root = this._getLiveRoot(sourceRoot);
        if (!root) return;

        const topic = scene || this.currentSceneData || this.selectedTopic || this.recommendTopics[0] || this._getFallbackTopic();
        const activeTopicTitle = String(topic?.title || this.selectedTopic?.title || '直播间').trim() || '直播间';
        const activeTopicKey = String(topic?._topicKey || this.selectedTopic?._topicKey || this._resolveTopicKey(topic, activeTopicTitle)).trim();
        const data = {
            ...(this._buildBaseScene(topic || this._getFallbackTopic(), activeTopicTitle, activeTopicKey) || {}),
            ...(topic && typeof topic === 'object' ? topic : {}),
            _topicTitle: activeTopicTitle,
            _topicKey: activeTopicKey
        };
        const isUserLive = this._isUserLiveScene(data) || activeTopicKey === 'topic_user_live';
        const userLiveProfile = isUserLive
            ? (this.app?.honeyData?.getHoneyUserProfile?.() || {})
            : null;
        const resolvedHostName = String(
            isUserLive
                ? (userLiveProfile?.nickname || data.host || '主播')
                : (data.host || '')
        ).trim() || '主播';
        const resolvedFans = String(
            isUserLive
                ? (data.fans || userLiveProfile?.followers || data.viewers || '0')
                : (data.fans || '0')
        ).trim() || '0';
        const displayFans = this._formatAudienceCountDisplay(resolvedFans);
        const displayViewers = this._formatAudienceCountDisplay(data.viewers || '0');
        const liveTitleText = this._sanitizeLiveRoomTitle(data.title || activeTopicTitle || '直播间');
        const collabNick = this._normalizeLiveCollabName(data.collab);
        const collabCost = Math.max(0, Number.parseInt(String(data.collabCost ?? 0), 10) || 0);
        const collabLabel = collabNick === '无' ? '申请联播' : `联播：${collabNick}`;
        const collabInfo = this._normalizeLiveCollabRequest(data?.collabRequestInfo || null);
        const collabMetaBrief = collabInfo?.hostType
            ? String(collabInfo.hostType).trim().slice(0, 6)
            : String(collabInfo?.rankHint || '').trim().replace(/^榜单\s*/i, '').slice(0, 6);
        const userLiveCollabLabel = collabNick === '无'
            ? '暂无联播'
            : `联播：${collabNick}${collabMetaBrief ? `·${collabMetaBrief}` : ''}`;
        const collabTitleText = collabNick === '无'
            ? '当前暂无联播'
            : `当前联播：${collabNick}${collabInfo?.hostType ? `｜${collabInfo.hostType}` : ''}${collabInfo?.rankHint ? `｜${collabInfo.rankHint}` : ''}`;
        const { introInnerHtml, hasIntro, giftListHtml } = this._buildLiveTickerMarkup(data);
        const naiPrompt = this._resolveSceneNaiPrompt(data);
        const imageStatus = String(data.imageGenerationStatus || '').trim();
        const generatedImageUrl = String(data.naiImageUrl || data.generatedImageUrl || data.imageUrl || '').trim();
        const liveVideoUrl = generatedImageUrl ? '' : this._buildLiveVideoUrl(data);
        const imageButtonLabel = imageStatus === 'loading'
            ? '生成中...'
            : (generatedImageUrl ? '重新生成图片' : (naiPrompt ? '生成直播图片' : '等待 NAI 提示词'));
        const imageButtonIcon = imageStatus === 'loading'
            ? 'fa-spinner fa-spin'
            : (generatedImageUrl ? 'fa-rotate' : (naiPrompt ? 'fa-wand-magic-sparkles' : 'fa-lock'));

        const titleEl = root.querySelector('#honey-ui-title-top');
        if (titleEl) titleEl.textContent = liveTitleText;
        const hostEl = root.querySelector('#honey-ui-host');
        if (hostEl) hostEl.textContent = resolvedHostName;
        const fansEl = root.querySelector('#honey-ui-fans');
        if (fansEl) fansEl.textContent = `粉丝 ${displayFans}`;
        const onlineEl = root.querySelector('#honey-ui-online');
        if (onlineEl) onlineEl.textContent = `${displayViewers} 在线`;

        const rankMini = root.querySelector('#honey-live-rank-mini');
        if (rankMini) {
            rankMini.classList.toggle('is-expanded', !!this._isLiveRankExpanded);
            rankMini.setAttribute('aria-expanded', this._isLiveRankExpanded ? 'true' : 'false');
            rankMini.setAttribute('title', this._isLiveRankExpanded ? '点击收起榜单' : '点击展开榜单');
            const rankList = rankMini.querySelector('.honey-live-rank-list');
            if (rankList) {
                rankList.innerHTML = this._buildLiveLeaderboardMarkup(data, isUserLive);
            }
        }

        const collabWrap = root.querySelector('#honey-ui-collab-wrap');
        if (collabWrap) {
            collabWrap.innerHTML = this._buildLiveCollabButtonHtml({
                isUserLive,
                collabNick,
                collabTitleText,
                userLiveCollabLabel,
                collabLabel,
                collabCost
            });
        }

        const introWrap = root.querySelector('#honey-live-intro-top');
        if (introWrap) {
            introWrap.innerHTML = introInnerHtml;
            introWrap.style.display = hasIntro ? '' : 'none';
        }

        const giftsWrap = root.querySelector('#honey-live-gifts');
        if (giftsWrap) {
            giftsWrap.innerHTML = giftListHtml;
        }

        const naiPlaceholder = root.querySelector('.honey-nai-placeholder');
        if (naiPlaceholder) {
            naiPlaceholder.classList.toggle('has-generated-image', !!generatedImageUrl);
            naiPlaceholder.style.background = liveVideoUrl ? '#000' : '';

            let generatedImg = naiPlaceholder.querySelector('.honey-nai-generated-image');
            if (generatedImageUrl) {
                if (!generatedImg) {
                    generatedImg = document.createElement('img');
                    generatedImg.className = 'honey-nai-generated-image';
                    generatedImg.alt = '';
                    naiPlaceholder.prepend(generatedImg);
                }
                generatedImg.src = generatedImageUrl;
            } else if (generatedImg) {
                generatedImg.remove();
            }

            let liveVideo = naiPlaceholder.querySelector('#honey-live-video-el');
            if (!generatedImageUrl && liveVideoUrl) {
                if (!liveVideo) {
                    liveVideo = document.createElement('video');
                    liveVideo.id = 'honey-live-video-el';
                    liveVideo.className = 'honey-live-video';
                    liveVideo.loop = true;
                    liveVideo.muted = true;
                    liveVideo.playsInline = true;
                    liveVideo.setAttribute('webkit-playsinline', '');
                    liveVideo.preload = 'metadata';
                    naiPlaceholder.prepend(liveVideo);
                }
                if (liveVideo.getAttribute('src') !== liveVideoUrl) {
                    liveVideo.setAttribute('src', liveVideoUrl);
                    liveVideo.load?.();
                }
                this._playLiveVideoIfCurrent(liveVideo, root);
            } else if (liveVideo) {
                liveVideo.pause?.();
                liveVideo.remove();
            }

            let glassEl = naiPlaceholder.querySelector('.honey-nai-glass');
            if (!generatedImageUrl) {
                if (!glassEl) {
                    glassEl = document.createElement('div');
                    glassEl.className = 'honey-nai-glass';
                    naiPlaceholder.appendChild(glassEl);
                }
                glassEl.setAttribute(
                    'style',
                    liveVideoUrl ? 'backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(0,0,0,0.1);' : ''
                );
            } else if (glassEl) {
                glassEl.remove();
            }
            this._bindGeneratedImageViewer(root);

            const statusEl = naiPlaceholder.querySelector('.honey-nai-status');
            if (imageStatus === 'failed' && data.imageGenerationError) {
                if (statusEl) {
                    statusEl.textContent = String(data.imageGenerationError || '').trim();
                    statusEl.classList.add('is-error');
                } else {
                    const nextStatus = document.createElement('div');
                    nextStatus.className = 'honey-nai-status is-error';
                    nextStatus.textContent = String(data.imageGenerationError || '').trim();
                    naiPlaceholder.appendChild(nextStatus);
                }
            } else if (statusEl) {
                statusEl.remove();
            }
        }

        const naiBtn = root.querySelector('#honey-test-nai-btn');
        if (naiBtn) {
            naiBtn.disabled = imageStatus === 'loading' || !naiPrompt;
            naiBtn.title = imageButtonLabel;
            naiBtn.classList.toggle('is-regenerate', !!generatedImageUrl);
            const iconEl = naiBtn.querySelector('i');
            if (iconEl) {
                iconEl.className = `fa-solid ${imageButtonIcon}`;
            }
            const labelEl = naiBtn.querySelector('.honey-unlock-label');
            if (labelEl) labelEl.textContent = imageButtonLabel;
        }

        const sceneText = String(data.description || '暂无文字描写。').trim() || '暂无文字描写。';
        const sceneModalEl = root.querySelector('#honey-ui-scene-modal');
        if (sceneModalEl) sceneModalEl.textContent = sceneText;
        const sceneInlineEl = root.querySelector('#honey-ui-scene');
        if (sceneInlineEl) sceneInlineEl.textContent = sceneText;
        const retryBtn = root.querySelector('#honey-scene-retry-btn');
        if (retryBtn) {
            const canRetry = this._canRetryLastLiveTurn();
            retryBtn.disabled = !canRetry;
            retryBtn.classList.toggle('is-loading', this._liveSendInFlight && canRetry);
        }
        const tagHistoryListEl = root.querySelector('#honey-scene-tag-history-list');
        if (tagHistoryListEl) {
            tagHistoryListEl.innerHTML = this._buildSceneTagHistoryPanelInnerHtml(data);
        }
        const collabLayer = root.querySelector('#honey-live-collab-request-layer');
        if (collabLayer) {
            collabLayer.innerHTML = this._buildLiveCollabRequestModalHtml(data);
        }
        const collabEndLayer = root.querySelector('#honey-live-collab-end-layer');
        if (collabEndLayer) {
            collabEndLayer.innerHTML = this._buildLiveCollabEndModalHtml(data);
        }

        this._syncTopTitleMarquee();
        this._syncIntroTicker();
        this._bindViewerLiveCollabButton(root, isUserLive);
        this._bindLiveTurnRetryButton(root);
    }

    _cloneLiveSceneData(scene = null) {
        try {
            return JSON.parse(JSON.stringify(scene || {}));
        } catch (e) {
            return { ...(scene || {}) };
        }
    }

    _normalizeSceneNaiTagHistory(list = []) {
        if (!Array.isArray(list)) return [];
        const output = [];
        list.forEach((item, idx) => {
            if (!item || typeof item !== 'object') return;
            const prompt = String(item.prompt || item.tag || item.naiPrompt || '').trim();
            if (!prompt) return;
            const tsRaw = Number(item.ts ?? item.time ?? item.createdAt ?? 0);
            const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? Math.floor(tsRaw) : Date.now();
            output.push({
                id: String(item.id || `${ts}_${idx}`),
                ts,
                prompt,
                source: String(item.source || 'ai').trim() || 'ai',
                topicKey: String(item.topicKey || '').trim(),
                topicTitle: String(item.topicTitle || '').trim()
            });
        });
        output.sort((a, b) => a.ts - b.ts);
        return output.slice(-60);
    }

    _getSceneNaiTagHistory(scene = null) {
        if (!scene || typeof scene !== 'object') return [];
        return this._normalizeSceneNaiTagHistory(scene.naiTagHistory || scene.sceneNaiTagHistory || []);
    }

    _filterSceneTagHistoryByTopic(history = [], topicKey = '', topicTitle = '') {
        const safeKey = String(topicKey || '').trim().toLowerCase();
        const safeTitle = String(topicTitle || '').trim();
        if (!Array.isArray(history) || (!safeKey && !safeTitle)) return Array.isArray(history) ? history : [];
        return history.filter((item) => {
            if (!item || typeof item !== 'object') return false;
            const itemKey = String(item.topicKey || '').trim().toLowerCase();
            const itemTitle = String(item.topicTitle || '').trim();
            if (safeKey && itemKey) return itemKey === safeKey;
            if (!safeKey && safeTitle && itemTitle) return itemTitle === safeTitle;
            return true;
        });
    }

    _appendSceneNaiTagHistory(history = [], prompt = '', source = 'ai') {
        const safePrompt = String(prompt || '').trim();
        if (!safePrompt) return this._normalizeSceneNaiTagHistory(history);
        const safeHistory = this._normalizeSceneNaiTagHistory(history);
        safeHistory.push({
            id: `${Date.now()}_${safeHistory.length + 1}`,
            ts: Date.now(),
            prompt: safePrompt,
            source: String(source || 'ai').trim() || 'ai'
        });
        return safeHistory.slice(-60);
    }

    _appendSceneNaiTagHistoryForTopic(history = [], prompt = '', {
        source = 'ai',
        topicKey = '',
        topicTitle = ''
    } = {}) {
        const safePrompt = String(prompt || '').trim();
        const safeHistory = this._normalizeSceneNaiTagHistory(history);
        if (!safePrompt) {
            return this._filterSceneTagHistoryByTopic(safeHistory, topicKey, topicTitle).slice(-60);
        }
        const next = [...safeHistory, {
            id: `${Date.now()}_${safeHistory.length + 1}`,
            ts: Date.now(),
            prompt: safePrompt,
            source: String(source || 'ai').trim() || 'ai',
            topicKey: String(topicKey || '').trim(),
            topicTitle: String(topicTitle || '').trim()
        }];
        return this._filterSceneTagHistoryByTopic(next, topicKey, topicTitle).slice(-60);
    }

    _replaceLatestSceneNaiTagHistoryForTopic(history = [], prompt = '', {
        source = 'ai_retag',
        topicKey = '',
        topicTitle = ''
    } = {}) {
        const safePrompt = String(prompt || '').trim();
        const safeHistory = this._normalizeSceneNaiTagHistory(history);
        if (!safePrompt) return safeHistory;
        const safeKey = String(topicKey || '').trim().toLowerCase();
        const safeTitle = String(topicTitle || '').trim();
        let targetIndex = -1;
        for (let i = safeHistory.length - 1; i >= 0; i -= 1) {
            const itemKey = String(safeHistory[i]?.topicKey || '').trim().toLowerCase();
            const itemTitle = String(safeHistory[i]?.topicTitle || '').trim();
            if ((safeKey && itemKey && itemKey === safeKey)
                || (!safeKey && safeTitle && itemTitle && itemTitle === safeTitle)
                || (!itemKey && !itemTitle)) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex < 0 && safeHistory.length > 0) targetIndex = safeHistory.length - 1;

        const nextItem = {
            id: `${Date.now()}_${safeHistory.length + 1}`,
            ts: Date.now(),
            prompt: safePrompt,
            source: String(source || 'ai_retag').trim() || 'ai_retag',
            topicKey: String(topicKey || '').trim(),
            topicTitle: String(topicTitle || '').trim()
        };
        if (targetIndex >= 0) {
            nextItem.id = String(safeHistory[targetIndex]?.id || nextItem.id);
            safeHistory[targetIndex] = nextItem;
            return safeHistory.slice(-60);
        }
        return [...safeHistory, nextItem].slice(-60);
    }

    _formatSceneTagHistoryTime(ts = 0) {
        const date = new Date(Number(ts) || Date.now());
        const pad = (v) => String(v).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    _buildSceneTagHistoryPanelInnerHtml(sceneData = null) {
        let history = this._filterSceneTagHistoryByTopic(
            this._getSceneNaiTagHistory(sceneData),
            sceneData?._topicKey || '',
            sceneData?._topicTitle || sceneData?.title || ''
        );
        if (!history.length) {
            const fallbackPrompt = this._resolveSceneNaiPrompt(sceneData || {});
            if (fallbackPrompt) {
                history = this._appendSceneNaiTagHistoryForTopic(
                    this._getSceneNaiTagHistory(sceneData || {}),
                    fallbackPrompt,
                    {
                        source: 'scene_fallback',
                        topicKey: sceneData?._topicKey || '',
                        topicTitle: sceneData?._topicTitle || sceneData?.title || ''
                    }
                );
                if (sceneData && typeof sceneData === 'object') {
                    sceneData.naiTagHistory = history;
                    if (sceneData === this.currentSceneData) {
                        this._persistCurrentScene();
                    }
                }
            }
        }
        if (!history.length) {
            return '<div class="honey-scene-tag-history-empty">暂无AI返回Tag记录</div>';
        }
        return history
            .slice()
            .reverse()
            .map((item, idx) => `
                <div class="honey-scene-tag-history-item">
                    <div class="honey-scene-tag-history-meta">
                        <span class="honey-scene-tag-history-time">${this._escapeHtml(this._formatSceneTagHistoryTime(item.ts))}</span>
                    </div>
                    <div class="honey-scene-tag-history-prompt">${this._escapeHtml(item.prompt).replace(/\n/g, '<br>')}</div>
                </div>
            `)
            .join('');
    }

    _buildSceneTagHistoryPanelHtml(sceneData = null) {
        if (!this._isSceneTagHistoryOpen) return '';
        return `
            <div class="honey-scene-tag-history-layer" id="honey-scene-tag-history-layer">
                <button class="honey-scene-tag-history-backdrop" id="honey-scene-tag-history-backdrop" type="button" aria-label="关闭Tag记录"></button>
                <div class="honey-scene-tag-history-panel" id="honey-scene-tag-history-panel" role="dialog" aria-modal="true" aria-label="AI生图Tag记录">
                    <div class="honey-scene-tag-history-head">
                        <div class="honey-scene-tag-history-title">AI生图Tag记录</div>
                        <button class="honey-scene-tag-history-close" id="honey-scene-tag-history-close" type="button" aria-label="关闭">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="honey-scene-tag-history-actions">
                        <button class="honey-scene-tag-history-retag" id="honey-scene-tag-history-retag" type="button" ${this._isRetaggingSceneNai ? 'disabled' : ''}>
                            <i class="fa-solid ${this._isRetaggingSceneNai ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}"></i>
                            <span>${this._isRetaggingSceneNai ? '重筛中' : '重筛最新Tag'}</span>
                        </button>
                    </div>
                    <div class="honey-scene-tag-history-list" id="honey-scene-tag-history-list">
                        ${this._buildSceneTagHistoryPanelInnerHtml(sceneData)}
                    </div>
                </div>
            </div>
        `;
    }

    _buildSceneRetagContext(scene = {}) {
        const safe = (value, maxLen = 1200) => String(value || '').trim().slice(0, maxLen);
        const comments = (Array.isArray(scene.comments) ? scene.comments : [])
            .map(item => typeof item === 'string'
                ? item
                : `${item?.user || item?.name || '观众'}：${item?.text || item?.content || ''}`)
            .map(item => safe(item, 160))
            .filter(Boolean)
            .slice(-8);
        const userChats = (Array.isArray(scene.userChats) ? scene.userChats : [])
            .map(item => typeof item === 'string'
                ? item
                : `${item?.sender || item?.name || '用户'}：${item?.text || item?.content || item?.message || ''}`)
            .map(item => safe(item, 180))
            .filter(Boolean)
            .slice(-8);
        const gifts = (Array.isArray(scene.gifts) ? scene.gifts : [])
            .map(item => safe(typeof item === 'string' ? item : JSON.stringify(item), 120))
            .filter(Boolean)
            .slice(-6);
        return [
            '【当前蜜语直播上下文】',
            `主播：${safe(scene.host, 80) || '未知'}`,
            `标题：${safe(scene.title || scene._topicTitle, 120) || '未知'}`,
            `分类：${safe(scene.tag || scene.category || scene.recommendCategory, 80) || '无'}`,
            `简介：${safe(scene.intro, 400) || '无'}`,
            '',
            '【当前直播剧情】',
            safe(scene.description, 1800) || '暂无剧情正文',
            '',
            comments.length ? `【最新评论】\n${comments.join('\n')}` : '【最新评论】\n暂无',
            userChats.length ? `【用户弹幕/互动】\n${userChats.join('\n')}` : '【用户弹幕/互动】\n暂无',
            gifts.length ? `【打赏记录】\n${gifts.join('\n')}` : '【打赏记录】\n暂无'
        ].join('\n');
    }

    _buildSceneRetagInstruction() {
        return [
            '请只重写当前蜜语直播画面的 NovelAI 英文生图 tag。',
            '要求：',
            '1. 只改写画面 tag，不续写剧情，不输出解释。',
            '2. 必须结合前文当前直播剧情、主播、标题、评论/弹幕互动，生成更贴合这一帧的英文逗号分隔 NAI tags。',
            '3. 不要输出中文句子，不要输出 Markdown，不要输出多余内容。',
            '4. 最终只输出一行，格式必须是：[画面]：[NAI英文tag提示词: tag1, tag2, tag3]'
        ].join('\n');
    }

    async _retagCurrentSceneNaiPrompt(sourceRoot = null) {
        if (this._isRetaggingSceneNai) return;
        const scene = this.currentSceneData || {};
        if (!this._resolveSceneNaiPrompt(scene)) {
            this.app?.phoneShell?.showNotification?.('蜜语', '当前直播没有可重筛的 NAI 提示词', '⚠️');
            return;
        }
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager || typeof apiManager.callAI !== 'function') {
            this.app?.phoneShell?.showNotification?.('蜜语', 'API Manager 未初始化', '❌');
            return;
        }

        this._isRetaggingSceneNai = true;
        const retagBtn = sourceRoot?.querySelector?.('#honey-scene-tag-history-retag');
        if (retagBtn) {
            retagBtn.disabled = true;
            retagBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>重筛中</span>';
        }

        try {
            const messages = [{
                role: 'system',
                content: '你是蜜语 APP 的 NovelAI tag 重写器。你只能按用户指定格式输出一行新的画面 tag，不得输出解释、剧情、寒暄或其他内容。',
                isPhoneMessage: true
            }];
            messages.push({
                role: 'assistant',
                content: this._buildSceneRetagContext(scene),
                isPhoneMessage: true
            });
            const worldbookMessage = await window.VirtualPhone?.worldbookManager?.buildWorldbookMessage?.('honey');
            if (worldbookMessage) messages.push(worldbookMessage);
            messages.push({
                role: 'user',
                content: this._buildSceneRetagInstruction(),
                isPhoneMessage: true
            });

            const result = await apiManager.callAI(messages, {
                max_tokens: 500,
                preserve_roles: false,
                appId: 'honey'
            });
            if (!result?.success) throw new Error(result?.error || 'AI 返回为空');
            const rawText = String(result.summary || result.content || result.text || '').trim();
            const nextPrompt = String(this.app?.honeyData?._extractNaiPrompt?.(rawText) || '').trim();
            if (!nextPrompt) throw new Error('AI 未返回有效的 [画面] NAI tag');

            const topicKey = this._getActiveTopicKey();
            const topicTitle = this._getActiveTopicTitle();
            const nextHistory = this._replaceLatestSceneNaiTagHistoryForTopic(
                this._getSceneNaiTagHistory(scene),
                nextPrompt,
                { source: 'ai_retag', topicKey, topicTitle }
            );
            this.currentSceneData = {
                ...(this.currentSceneData || scene),
                naiPrompt: nextPrompt,
                imageGenerationPrompt: nextPrompt,
                naiTagHistory: nextHistory,
                _topicTitle: topicTitle,
                _topicKey: topicKey
            };
            this._persistCurrentScene();

            const listEl = sourceRoot?.querySelector?.('#honey-scene-tag-history-list');
            if (listEl) {
                listEl.innerHTML = this._buildSceneTagHistoryPanelInnerHtml(this.currentSceneData);
            }
            this.app?.phoneShell?.showNotification?.('蜜语', '最新 NAI tag 已重筛并覆盖', '✅');
        } catch (err) {
            console.error('[Honey] 重筛 NAI tag 失败:', err);
            this.app?.phoneShell?.showNotification?.('重筛失败', err?.message || String(err || 'AI 请求失败'), '❌');
        } finally {
            this._isRetaggingSceneNai = false;
            const nextRetagBtn = sourceRoot?.querySelector?.('#honey-scene-tag-history-retag');
            if (nextRetagBtn) {
                nextRetagBtn.disabled = false;
                nextRetagBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><span>重筛最新Tag</span>';
            }
        }
    }

    _canRetryLastLiveTurn() {
        const retry = this._lastLiveTurnRetry;
        if (!retry?.snapshot || typeof retry.snapshot !== 'object') return false;
        const activeTopicTitle = String(this._getActiveTopicTitle() || '').trim();
        const activeTopicKey = String(this._getActiveTopicKey() || '').trim();
        const retryTopicTitle = String(retry.topicTitle || '').trim();
        const retryTopicKey = String(retry.topicKey || '').trim();
        return (retryTopicKey && retryTopicKey === activeTopicKey)
            || (!retryTopicKey && retryTopicTitle && retryTopicTitle === activeTopicTitle);
    }

    _storeLiveTurnRetrySnapshot({ topicTitle = '', topicKey = '', userMessage = '', sceneSnapshot = null, resetSession = false } = {}) {
        const safeMessage = String(userMessage || '').trim();
        if (!sceneSnapshot || typeof sceneSnapshot !== 'object') return;
        this._lastLiveTurnRetry = {
            topicTitle: String(topicTitle || '').trim(),
            topicKey: String(topicKey || '').trim(),
            userMessage: safeMessage,
            resetSession: resetSession === true,
            snapshot: this._cloneLiveSceneData(sceneSnapshot),
            createdAt: Date.now()
        };
    }

    async _retryLastLiveTurn(sourceRoot = null) {
        if (this._isGeneratingScene || this._liveSendInFlight) return;
        if (!this._canRetryLastLiveTurn()) {
            this.app?.phoneShell?.showNotification?.('无法重试', '还没有可重新生成的上一轮回复', '⚠️');
            return;
        }

        const retry = this._lastLiveTurnRetry;
        const root = this._getLiveRoot(sourceRoot);
        const topicTitle = String(retry.topicTitle || this._getActiveTopicTitle()).trim();
        const topicKey = String(retry.topicKey || this._getActiveTopicKey()).trim();
        const restoredScene = {
            ...this._cloneLiveSceneData(retry.snapshot),
            _topicTitle: topicTitle,
            _topicKey: topicKey || this._resolveTopicKey(retry.snapshot, topicTitle)
        };

        this._silenceLiveSpeaker();
        this._liveSendInFlight = true;
        this.currentSceneData = restoredScene;
        this.app?.honeyData?.saveTopicScene?.(topicKey || topicTitle, restoredScene, topicTitle);
        this._persistCurrentScene();
        this._refreshLivePageDom({ sourceRoot: root, scene: restoredScene });

        const currentRoot = this._getLiveRoot(root);
        const retryBtn = currentRoot?.querySelector?.('#honey-scene-retry-btn');
        if (retryBtn) {
            retryBtn.disabled = true;
            retryBtn.classList.add('is-loading');
        }

        try {
            await this._generateCurrentTopicScene({
                resetSession: retry.resetSession === true,
                notify: false,
                forceTopicTitle: topicTitle,
                forceTopicKey: topicKey,
                sourceRoot: currentRoot,
                userMessage: retry.userMessage
            });
            this.app?.phoneShell?.showNotification?.('蜜语', '已重新生成本轮回复', '✅');
        } catch (err) {
            console.error('蜜语本轮重试失败:', err);
            this.app?.phoneShell?.showNotification?.('重试失败', err?.message || String(err), '❌');
        } finally {
            this._liveSendInFlight = false;
            this._refreshLivePageDom({ sourceRoot: this._getLiveRoot(currentRoot) });
        }
    }

    _bindLiveTurnRetryButton(root = null) {
        const liveRoot = this._getLiveRoot(root);
        const btn = liveRoot?.querySelector?.('#honey-scene-retry-btn');
        if (!btn || btn.dataset.retryBound === '1') return;
        btn.dataset.retryBound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._retryLastLiveTurn(liveRoot);
        });
    }

    _bindViewerLiveCollabButton(root = null, isUserLive = false) {
        const liveRoot = this._getLiveRoot(root);
        const btn = liveRoot?.querySelector?.('#honey-collab-btn');
        if (!btn) return;
        if (isUserLive || this._isUserLiveScene(this.currentSceneData)) return;
        if (btn.dataset.collabBound === '1') return;

        btn.dataset.collabBound = '1';
        btn.addEventListener('click', async (e) => {
            if (this._isUserLiveScene(this.currentSceneData)) return;
            e.stopPropagation();
            if (this._isGeneratingScene) return;

            const currentBtn = e.currentTarget;
            const collabName = String(currentBtn?.dataset?.collabName || '').trim() || '无';
            const collabCost = Math.max(0, Number.parseInt(String(currentBtn?.dataset?.collabCost || '0').trim(), 10) || 0);

            if (collabName !== '无') {
                this.app.phoneShell.showNotification('联播占线', '当前已有观众正在联播，请稍后再试', '⚠️');
                return;
            }

            const confirmText = `确定要申请与主播联播吗？\n本次上麦将扣除：${collabCost}金币`;
            if (!window.confirm(confirmText)) return;

            if (collabCost > 0) {
                const consumeResult = this.app?.honeyData?.consumeHoneyCoins?.(collabCost) || { success: false, balanceBefore: 0, balanceAfter: 0 };
                if (!consumeResult.success) {
                    this.app.phoneShell.showNotification(
                        '金币不足',
                        `本次需${this._formatCoinDisplay(collabCost)}金币，当前仅${this._formatCoinDisplay(consumeResult.balanceBefore || 0)}金币`,
                        '⚠️'
                    );
                    return;
                }
                this.app.phoneShell.showNotification('联播', '支付成功，正在连接主播...', '✅');
            }

            currentBtn.disabled = true;
            currentBtn.classList.add('is-loading');
            currentBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 连接中';

            try {
                await this._generateCurrentTopicScene({
                    resetSession: false,
                    notify: false,
                    sourceRoot: liveRoot,
                    userMessage: '【系统强制提示：用户已支付金币申请上麦联播。请主播在接下来的回复中同意接通，将联播对象改为{{user}}，并开始与{{user}}进行激情的一对一联播互动。】'
                });
            } catch (err) {
                console.error('联播申请失败:', err);
                this.app.phoneShell.showNotification('错误', err.message || String(err), '❌');
            } finally {
                const currentRoot = this._getLiveRoot(liveRoot);
                const currentCollabBtn = currentRoot?.querySelector('#honey-collab-btn');
                if (currentCollabBtn) {
                    currentCollabBtn.disabled = false;
                    currentCollabBtn.classList.remove('is-loading');
                }
                this._refreshLivePageDom({ sourceRoot: currentRoot });
            }
        });
    }

    renderFollowPage() {
        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const onlineTopicMap = this._buildOnlineTopicMap();
        const listHtml = followedHosts.length > 0
            ? followedHosts.map((host) => {
                const hostName = String(host?.name || '').trim();
                const avatarUrl = String(host?.avatarUrl || '').trim();
                const figureLabel = this._resolveFollowFigureTag(hostName, host?.figure);
                const boundVideoUrl = String(host?.boundVideoUrl || '').trim();
                const isOnline = this._isFollowHostOnline(hostName, onlineTopicMap);
                const favorability = Math.max(0, Math.min(100, Number(host?.favorability ?? host?.affection ?? 0) || 0));
                const hasWechatChat = !!String(host?.wechatChatId || host?.wechatContactId || '').trim();
                const historyMap = this.app?.honeyData?.getHostHistory?.(hostName) || {};
                const dateKeys = Object.keys(historyMap)
                    .filter(Boolean)
                    .sort((a, b) => String(b).localeCompare(String(a)));
                const historyHtml = `
                    <button class="honey-history-date-item" data-action="open-host-chat-history" data-host-name="${this._escapeHtml(hostName)}">
                        <span class="honey-history-date-left"><i class="fa-regular fa-comment-dots"></i> 查看所有互动记录</span>
                        <span class="honey-history-date-right">详情 &gt;</span>
                    </button>
                `;
                const boundVideoName = boundVideoUrl
                    ? this._formatFollowVideoName(boundVideoUrl)
                    : '未选择';
                const referenceImage = this._normalizeUploadedBackgroundUrl(host?.naiReferenceImage || '');
                const hasReferenceImage = /^(?:https?:\/\/|\/backgrounds\/)/i.test(referenceImage);
                const referenceEnabled = hasReferenceImage && host?.naiReferenceEnabled !== false && host?.naiReferenceEnabled !== 'false';
                const rawReferenceStrength = Number(host?.naiReferenceStrength ?? 0.7);
                const referenceStrength = Math.max(0, Math.min(1, Number.isFinite(rawReferenceStrength) ? rawReferenceStrength : 0.7));
                const referencePercent = Math.round(referenceStrength * 100);
                const referencePreviewStyle = hasReferenceImage
                    ? ` style="${this._buildAvatarInlineStyle(`${referenceImage}${referenceImage.includes('?') ? '&' : '?'}t=${Date.now()}`)}"`
                    : '';
                const referenceStateText = hasReferenceImage
                    ? (referenceEnabled ? '已启用' : '已暂停')
                    : '未设置';
                const avatarStyle = avatarUrl
                    ? ` style="${this._buildAvatarInlineStyle(avatarUrl)}"`
                    : '';
                const photoCls = avatarUrl ? ' is-photo' : '';
                const gotoLiveInlineHtml = `
                    <span
                        class="honey-goto-live-btn"
                        data-action="goto-follow-live"
                        data-host-name="${this._escapeHtml(hostName)}"
                        role="button"
                        tabindex="0"
                        style="${!isOnline ? 'background: linear-gradient(135deg, rgba(120, 120, 120, 0.8), rgba(80, 80, 80, 0.78)); border-color: rgba(200, 200, 200, 0.42); animation: none;' : ''}"
                    >进入直播间</span>
                `;
                return `
                    <div class="honey-follow-item" data-host-name="${this._escapeHtml(hostName)}">
                        <button class="honey-follow-host-row" data-action="toggle-follow-history" data-host-name="${this._escapeHtml(hostName)}">
                            <span class="honey-follow-host-avatar${photoCls}"${avatarStyle}></span>
                            <span class="honey-follow-host-meta">
                                <span class="honey-follow-host-topline">
                                    <span class="honey-follow-host-name">${this._escapeHtml(hostName)}</span>
                                    <span class="honey-follow-host-figure">${this._escapeHtml(figureLabel)}</span>
                                </span>
                                <span class="honey-follow-host-subline">
                                    ${gotoLiveInlineHtml}
                                    <span class="honey-follow-badge ${isOnline ? 'online' : 'offline'}">${isOnline ? '在线' : '⚪ 离线'}</span>
                                </span>
                                <span class="honey-follow-host-count">已存档 ${dateKeys.length} 天 ${boundVideoUrl ? '· 已绑定专属视频' : '· 未绑定视频'}</span>
                                <div class="honey-follow-favor">
                                    <span class="honey-follow-favor-label">好感度 ${favorability}%</span>
                                    <span class="honey-follow-favor-track">
                                        <span class="honey-follow-favor-fill" style="width: ${favorability}%;"></span>
                                    </span>
                                </div>
                            </span>
                            <i class="fa-solid fa-chevron-down honey-follow-host-arrow"></i>
                        </button>
                        <div class="honey-follow-history-wrap">
                            <div class="honey-follow-section-title">互动记录</div>
                            ${historyHtml}
                            <div class="honey-follow-section-title">绑定直播视频</div>
                            <div class="honey-follow-video-bind-row">
                                <button
                                    class="honey-follow-video-picker-trigger"
                                    data-action="open-follow-video-modal"
                                    data-host-name="${this._escapeHtml(hostName)}"
                                >
                                    <span class="honey-follow-video-picker-label"><i class="fa-solid fa-layer-group"></i> 选择专属视频</span>
                                    <span class="honey-follow-video-picker-current">${this._escapeHtml(boundVideoName)}</span>
                                    <i class="fa-solid fa-chevron-right honey-follow-video-picker-arrow"></i>
                                </button>
                            </div>
                            <div class="honey-follow-section-title">角色参考图</div>
                            <div class="honey-follow-reference-card${hasReferenceImage ? ' has-image' : ''}">
                                <input
                                    type="file"
                                    class="honey-follow-reference-upload"
                                    data-host-name="${this._escapeHtml(hostName)}"
                                    accept="image/png,image/jpeg,image/webp,image/*"
                                    style="display:none;"
                                >
                                <div class="honey-follow-reference-main">
                                    <button
                                        class="honey-follow-reference-preview"
                                        data-action="upload-follow-reference"
                                        data-host-name="${this._escapeHtml(hostName)}"
                                        aria-label="上传角色参考图"
                                        ${referencePreviewStyle}
                                    >${hasReferenceImage ? '' : '<i class="fa-regular fa-image"></i>'}</button>
                                    <div class="honey-follow-reference-meta">
                                        <div class="honey-follow-reference-title">
                                            <span><i class="fa-solid fa-user-check"></i> 固定形象</span>
                                            <span class="honey-follow-reference-state">${this._escapeHtml(referenceStateText)}</span>
                                        </div>
                                        <div class="honey-follow-reference-desc">生图时自动作为 NovelAI 角色参考，保持这个主播的脸和气质。</div>
                                    </div>
                                    <label class="honey-toggle-switch honey-follow-reference-switch" title="启用角色参考图">
                                        <input
                                            type="checkbox"
                                            class="honey-follow-reference-enabled"
                                            data-host-name="${this._escapeHtml(hostName)}"
                                            ${referenceEnabled ? 'checked' : ''}
                                            ${hasReferenceImage ? '' : 'disabled'}
                                        >
                                        <span class="honey-toggle-slider"></span>
                                    </label>
                                </div>
                                <div class="honey-follow-reference-controls">
                                    <button
                                        class="honey-follow-action-btn"
                                        data-action="upload-follow-reference"
                                        data-host-name="${this._escapeHtml(hostName)}"
                                    >${hasReferenceImage ? '替换参考图' : '上传参考图'}</button>
                                    <button
                                        class="honey-follow-action-btn is-danger"
                                        data-action="remove-follow-reference"
                                        data-host-name="${this._escapeHtml(hostName)}"
                                        ${hasReferenceImage ? '' : 'disabled'}
                                    >删除</button>
                                </div>
                                <label class="honey-follow-reference-strength-row">
                                    <span>参考强度 <b class="honey-follow-reference-strength-value">${referencePercent}%</b></span>
                                    <input
                                        type="range"
                                        class="honey-follow-reference-strength"
                                        data-host-name="${this._escapeHtml(hostName)}"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value="${this._escapeHtml(String(referenceStrength))}"
                                        ${hasReferenceImage ? '' : 'disabled'}
                                    >
                                </label>
                            </div>
                            <div class="honey-follow-actions">
                                <button
                                    class="honey-follow-action-btn"
                                    data-action="${hasWechatChat ? 'open-host-wechat-chat' : 'request-host-wechat-friend'}"
                                    data-host-name="${this._escapeHtml(hostName)}"
                                >${hasWechatChat ? '打开微信' : '加好友'}</button>
                                <button
                                    class="honey-follow-action-btn"
                                    data-action="unbind-follow-video"
                                    data-host-name="${this._escapeHtml(hostName)}"
                                >取消视频绑定</button>
                                <button
                                    class="honey-follow-action-btn is-danger"
                                    data-action="unfollow-host"
                                    data-host-name="${this._escapeHtml(hostName)}"
                                >取消关注</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')
            : `
                <div class="honey-follow-empty">
                    <div class="honey-follow-empty-icon"><i class="fa-regular fa-heart"></i></div>
                    <div class="honey-follow-empty-title">暂无关注的主播</div>
                    <div class="honey-follow-empty-desc">进入直播间点击关注后，会在这里沉淀主播历史记录。</div>
                </div>
            `;

        const html = `
            <div class="honey-app honey-page-follow">
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title">❤️</div>
                    <button class="honey-icon-btn" id="honey-settings-btn" title="蜜语设置"><i class="fa-solid fa-gear"></i></button>
                </div>

                <div class="honey-tabs">
                    <div class="honey-tab" id="honey-tab-recommend">推荐</div>
                    <div class="honey-tab" id="honey-tab-live">直播</div>
                    <div class="honey-tab active" id="honey-tab-follow">关注</div>
                    <div class="honey-tab" id="honey-tab-mine">私密</div>
                </div>

                <div class="honey-content">
                    <div class="honey-recommend-wrap">
                        <div class="honey-follow-list">${listHtml}</div>
                    </div>
                </div>
                <div class="honey-follow-video-modal" id="honey-follow-video-modal" aria-hidden="true">
                    <div class="honey-follow-video-modal-backdrop" data-action="close-follow-video-modal"></div>
                    <div class="honey-follow-video-modal-panel">
                        <div class="honey-follow-video-modal-head">
                            <div class="honey-follow-video-modal-title" id="honey-follow-video-modal-title">选择专属视频</div>
                            <button class="honey-follow-video-modal-close" data-action="close-follow-video-modal" aria-label="关闭">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div class="honey-follow-video-modal-list" id="honey-follow-video-modal-list"></div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'honey-follow');
        this._applyPhoneChromeTheme();
        this.bindPlaceholderEvents();
    }

    renderHistoryPage() {
        const hostName = this._historyHostName || '未知主播';
        const historyMap = this.app?.honeyData?.getHostHistory?.(hostName) || {};
        const summary = this.app?.honeyData?.getHostHistorySummary?.(hostName) || {};
        const summaryText = String(summary.text || '').trim();
        const summaryTimeText = this._formatHoneySummaryStoryTime(summary);
        const dateKeys = Object.keys(historyMap)
            .filter(key => key && !String(key).startsWith('_'))
            .sort((a, b) => String(a).localeCompare(String(b)));

        let chatHtml = '';
        const seenTurns = new Set();

        dateKeys.forEach(dateKey => {
            const dayScene = historyMap[dateKey];
            const dayTurns = this.app?.honeyData?._normalizeContinuePromptTurns(
                dayScene?.promptTurns,
                this.app?.honeyData?.maxStoredPromptTurns,
                { preserveLength: true }
            ) || [];
            let addedDate = false;

            dayTurns.forEach(turn => {
                const hash = this.app?.honeyData?._simpleHash(String(dateKey) + String(turn.assistantContext || '') + String(turn.userMessage || ''));
                if (!seenTurns.has(hash)) {
                    const userMessage = String(turn.userMessage || '').trim();
                    const displayContext = String(turn.responseContext || turn.assistantContext || '').trim();
                    seenTurns.add(hash);
                    if (!addedDate) {
                        chatHtml += `<div style="text-align: center; margin: 15px 0 10px; font-size: 10px; color: rgba(255,255,255,0.4);">――― ${dateKey} ―――</div>`;
                        addedDate = true;
                    }
                    chatHtml += `
                        ${userMessage ? `<div style="display: flex; justify-content: flex-end; margin-bottom: 12px;">
                            <div style="max-width: 85%; padding: 8px 12px; background: #ff4785; color: #fff; border-radius: 14px 4px 14px 14px; font-size: 12px; word-break: break-word; box-shadow: 0 2px 8px rgba(255, 71, 133, 0.3);">${this._escapeHtml(turn.userMessage)}</div>
                        </div>` : ''}
                        <div style="display: flex; justify-content: flex-start; margin-bottom: 18px;">
                            <div style="max-width: 90%; padding: 10px 12px; background: rgba(255,255,255,0.1); color: #eef2ff; border-radius: 4px 14px 14px 14px; font-size: 11px; line-height: 1.5; word-break: break-word; border: 1px solid rgba(255,255,255,0.08);">${this._escapeHtml(displayContext).replace(/\n/g, '<br>')}</div>
                        </div>
                    `;
                }
            });
        });

        const html = `
            <div class="honey-app honey-page-history">
                <!-- 顶部导航栏（严格复用原有类名，保证不被挤压） -->
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back-from-history"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title" style="font-size: 14px;">${this._escapeHtml(hostName)} 的记录</div>
                    <button class="honey-icon-btn" id="honey-history-summary-btn" title="总结记录" aria-label="总结记录"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                </div>
                
                <!-- 内容滚动区（利用 css 中已有的 honey-content flex 属性） -->
                <div class="honey-content" style="background: linear-gradient(160deg, rgba(54, 26, 68, 0.98), rgba(28, 15, 36, 0.98)); padding: 12px; overflow-y: auto; -webkit-overflow-scrolling: touch;">
                    ${summaryText ? `
                        <div style="position: relative; margin: 8px 0 14px; padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.12); color: #fff;">
                            <button id="honey-history-summary-clear-turns" type="button" aria-label="清理已总结原文" title="清理已总结原文" style="position: absolute; right: 40px; top: 8px; width: 26px; height: 26px; border: 0; border-radius: 50%; background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.92); display: flex; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-broom"></i>
                            </button>
                            <button id="honey-history-summary-delete" type="button" aria-label="删除总结" title="删除总结" style="position: absolute; right: 8px; top: 8px; width: 26px; height: 26px; border: 0; border-radius: 50%; background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.92); display: flex; align-items: center; justify-content: center;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                            <div style="font-size: 12px; font-weight: 800; margin: 0 62px 8px 0;">蜜语记录总结</div>
                            ${summaryTimeText ? `<div style="font-size: 10px; color: rgba(255,255,255,0.58); margin: -3px 62px 8px 0;">${this._escapeHtml(summaryTimeText)}</div>` : ''}
                            <div style="font-size: 11px; line-height: 1.55; white-space: pre-wrap;">${this._escapeHtml(summaryText)}</div>
                        </div>
                    ` : ''}
                    ${chatHtml || '<div style="text-align: center; color: #ffffff !important; opacity: 0.72; margin-top: 50px; font-size: 12px;">暂无互动记录</div>'}
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'honey-history');
        this._applyPhoneChromeTheme();

        const currentView = document.querySelector('.phone-view-current') || document;
        const backBtn = currentView.querySelector('#honey-back-from-history');
        if (backBtn) {
            backBtn.onclick = (e) => {
                e.preventDefault();
                this.currentPage = 'follow';
                this.render();
            };
        }

        currentView.querySelector('#honey-history-summary-btn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const result = await this.app?.honeyData?.summarizeHostHistory?.(hostName);
                if (result?.changed) {
                    const remaining = Number(result.remaining || 0);
                    this.app.phoneShell.showNotification('蜜语', `已总结 ${result.added || 0} 条新记录${remaining > 0 ? `，还有 ${remaining} 条待总结` : ''}`, '✅');
                } else {
                    this.app.phoneShell.showNotification('蜜语', '没有新的未总结记录', 'ℹ️');
                }
                this.renderHistoryPage();
            } catch (err) {
                console.error('蜜语记录总结失败:', err);
                this.app.phoneShell.showNotification('总结失败', err?.message || String(err || '请稍后重试'), '❌');
                if (btn?.isConnected) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
                }
            }
        });

        currentView.querySelector('#honey-history-summary-clear-turns')?.addEventListener('click', (e) => {
            e.preventDefault();
            if (!confirm('确定清理这条总结已经覆盖的原始直播历史吗？\n\n总结会保留，未总结的新记录也会保留。')) return;
            const result = this.app?.honeyData?.clearSummarizedHostHistoryTurns?.(hostName);
            const removed = Number(result?.removed || 0);
            this.app.phoneShell.showNotification('蜜语', removed > 0 ? `已清理 ${removed} 条已总结原文` : '没有可清理的已总结原文', removed > 0 ? '🧹' : 'ℹ️');
            this.renderHistoryPage();
        });

        currentView.querySelector('#honey-history-summary-delete')?.addEventListener('click', (e) => {
            e.preventDefault();
            if (!confirm('确定删除这条蜜语记录总结吗？\n\n原始互动记录会保留，之后可以重新总结。')) return;
            const ok = this.app?.honeyData?.clearHostHistorySummary?.(hostName);
            if (ok) {
                this.app.phoneShell.showNotification('蜜语', '已删除记录总结，可重新总结', '🗑️');
                this.renderHistoryPage();
            }
        });

        setTimeout(() => {
            const contentBox = currentView.querySelector('.honey-content');
            if (contentBox) contentBox.scrollTop = contentBox.scrollHeight;
        }, 50);
    }

    _formatHoneySummaryStoryTime(summary = {}) {
        const storyTime = summary?.storyTime && typeof summary.storyTime === 'object' ? summary.storyTime : null;
        const storyDate = String(storyTime?.date || '').trim();
        const storyClock = String(storyTime?.time || '').trim();
        if (storyDate || storyClock) {
            return `总结时间：${[storyDate, storyClock].filter(Boolean).join(' ')}`;
        }
        return '';
    }

    renderMinePage() {
        const profile = this.app?.honeyData?.getHoneyUserProfile?.() || {
            nickname: '主播',
            liveTitle: '我的直播间',
            avatarUrl: '',
            intro: '今晚来我直播间聊天。',
            followers: 0,
            accountId: '@user_live',
            gender: 'female'
        };
        const friendRequests = this.app?.honeyData?.getHoneyFriendRequests?.() || [];
        const friends = this.app?.honeyData?.getHoneyFriends?.() || [];
        const displayAvatar = this._getHoneyDisplayUserAvatar(profile);
        const avatarStyle = displayAvatar ? ` style="${this._buildAvatarInlineStyle(displayAvatar)}"` : '';
        const avatarPhotoClass = displayAvatar ? ' is-photo' : '';

        const requestHtml = friendRequests.length > 0
            ? friendRequests.map((item) => `
                ${(() => {
                    const sourceText = item.requestType === 'host'
                        ? (item.source && item.source !== item.name ? `${item.source} · 主播申请` : '主播申请')
                        : (item.source || '直播间申请');
                    return `
                <div class="honey-mine-request-item">
                    <div class="honey-mine-request-top">
                        <span class="honey-mine-request-avatar${item.avatarUrl ? ' is-photo' : ''}"${item.avatarUrl ? ` style="${this._buildAvatarInlineStyle(item.avatarUrl)}"` : ''}></span>
                        <span class="honey-mine-request-meta">
                            <span class="honey-mine-request-name">${this._escapeHtml(item.name)}</span>
                            <span class="honey-mine-request-source">${this._escapeHtml(sourceText)}</span>
                        </span>
                        <span class="honey-mine-request-inline-actions">
                            <button class="honey-follow-action-btn honey-follow-action-btn-compact" data-action="accept-honey-friend" data-name="${this._escapeHtml(item.name)}">同意</button>
                            <button class="honey-follow-action-btn honey-follow-action-btn-compact is-danger" data-action="reject-honey-friend" data-name="${this._escapeHtml(item.name)}">拒绝</button>
                        </span>
                    </div>
                    <div class="honey-mine-request-message">${this._escapeHtml(item.message || '想加你为好友')}</div>
                </div>
                    `;
                })()}
            `).join('')
            : '<div class="honey-follow-empty-desc">当前没有新的好友申请。</div>';

        const friendHtml = friends.length > 0
            ? friends.map((item) => `
                <div class="honey-mine-friend-item">
                    <span class="honey-follow-host-avatar${item.avatarUrl ? ' is-photo' : ''}"${item.avatarUrl ? ` style="${this._buildAvatarInlineStyle(item.avatarUrl)}"` : ''}></span>
                    <span class="honey-mine-friend-meta">
                        <span class="honey-mine-friend-head">
                            <span class="honey-follow-host-name">${this._escapeHtml(item.name)} <span class="honey-mine-friend-badge"><i class="fa-solid fa-heart"></i>${this._escapeHtml(item.requestType === 'host' ? '主播' : '蜜语')}</span></span>
                            <span class="honey-mine-friend-actions">
                                <button class="honey-follow-action-btn honey-follow-action-btn-compact" data-action="open-honey-friend-chat" data-name="${this._escapeHtml(item.name)}">聊天</button>
                                <button class="honey-follow-action-btn honey-follow-action-btn-compact is-danger" data-action="remove-honey-friend" data-name="${this._escapeHtml(item.name)}">删除</button>
                            </span>
                        </span>
                        <span class="honey-follow-host-count">${this._escapeHtml(item.message || '已成为你的蜜语好友')}</span>
                    </span>
                </div>
            `).join('')
            : '<div class="honey-follow-empty-desc">还没有通过的好友，开播后陌生网友会向你发来申请。</div>';

        const html = `
            <div class="honey-app honey-page-mine">
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title">❤️</div>
                    <button class="honey-icon-btn" id="honey-settings-btn" title="蜜语设置"><i class="fa-solid fa-gear"></i></button>
                </div>

                <div class="honey-tabs">
                    <div class="honey-tab" id="honey-tab-recommend">推荐</div>
                    <div class="honey-tab" id="honey-tab-live">直播</div>
                    <div class="honey-tab" id="honey-tab-follow">关注</div>
                    <div class="honey-tab active" id="honey-tab-mine">私密</div>
                </div>

                <div class="honey-content">
                    <div class="honey-follow-list honey-mine-list">
                        <div class="honey-settings-card honey-mine-account-card">
                            <div class="honey-mine-account-head">
                                <button class="honey-mine-avatar${avatarPhotoClass}" id="honey-mine-avatar-btn"${avatarStyle}>${displayAvatar ? '' : this._escapeHtml(String(profile.nickname || '我').slice(0, 1))}</button>
                                <div class="honey-mine-account-meta">
                                    <div class="honey-settings-label honey-mine-inline-label">直播昵称</div>
                                    <input type="text" id="honey-mine-live-nickname" class="honey-settings-input honey-mine-live-nickname" maxlength="20" value="${this._escapeHtml(profile.nickname || '')}" placeholder="输入直播昵称">
                                    <div class="honey-mine-gender-row">
                                        <span class="honey-settings-label honey-mine-gender-label">性别</span>
                                        <div class="honey-mine-gender-switch" role="radiogroup" aria-label="性别">
                                            <button type="button" class="honey-mine-gender-btn ${profile.gender === 'male' ? 'is-active' : ''}" data-gender="male" aria-pressed="${profile.gender === 'male' ? 'true' : 'false'}">男</button>
                                            <button type="button" class="honey-mine-gender-btn ${profile.gender !== 'male' ? 'is-active' : ''}" data-gender="female" aria-pressed="${profile.gender !== 'male' ? 'true' : 'false'}">女</button>
                                        </div>
                                        <input type="hidden" id="honey-mine-gender" value="${this._escapeHtml(profile.gender || 'female')}">
                                    </div>
                                </div>
                                <button class="honey-settings-btn honey-settings-btn-primary honey-mine-start-btn" id="honey-start-my-live">开始直播</button>
                            </div>
                            <div class="honey-mine-account-stats">
                                <div class="honey-mine-account-stat">
                                    <span class="honey-mine-account-stat-num">${this._escapeHtml(this._formatAudienceCountDisplay(profile.followers || 0))}</span>
                                    <span class="honey-mine-account-stat-label">粉丝</span>
                                </div>
                                <div class="honey-mine-account-stat honey-mine-account-stat-topic">
                                    <span class="honey-mine-account-stat-label">今日直播主题</span>
                                    <input type="text" id="honey-mine-live-title" class="honey-settings-input honey-mine-stat-input" maxlength="40" value="${this._escapeHtml(profile.liveTitle || '')}" placeholder="输入本场直播主题">
                                </div>
                            </div>
                            <input type="file" id="honey-mine-avatar-upload" accept="image/png,image/jpeg,image/webp,image/gif,image/*" style="display:none;">
                            <div class="honey-settings-label">直播简介</div>
                            <textarea id="honey-mine-intro" class="honey-prompt-editor honey-mine-intro" placeholder="介绍一下你的直播风格、营业内容和想吸引的观众">${this._escapeHtml(profile.intro || '')}</textarea>
                            <div class="honey-settings-actions">
                                <button class="honey-settings-btn honey-settings-btn-muted" id="honey-save-mine-profile">保存账号设置</button>
                            </div>
                        </div>

                        <div class="honey-settings-card">
                            <div class="honey-settings-card-title">好友申请</div>
                            <div class="honey-settings-desc">陌生网友会在你开播互动后申请加你好友。</div>
                            <div class="honey-mine-request-list">${requestHtml}</div>
                        </div>

                        <div class="honey-settings-card">
                            <div class="honey-settings-card-title">好友列表</div>
                            <div class="honey-settings-desc">通过的好友会沉淀在这里，后续可继续联动。</div>
                            <div class="honey-mine-friend-list">${friendHtml}</div>
                        </div>
                    </div>
                </div>
                ${this._buildLiveVisibilityModalHtml()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'honey-mine');
        this._applyPhoneChromeTheme();
        this.bindMineEvents();
    }

    renderSettingsPage() {
        const promptManager = this._getPromptManager();
        const promptConfig = this._getHoneyPromptConfig(promptManager);
        const overridePromptConfig = this._getHoneyOverridePromptConfig(promptManager);
        const userLivePromptConfig = this._getHoneyUserLivePromptConfig(promptManager);
        const bgVideoUrl = this.app.honeyData?.getRecommendBgVideo?.() || '';
        const honeyNickname = this.app.honeyData?.getHoneyUserNickname?.() || '观众';
        const honeyCoinBalance = this.app.honeyData?.getHoneyCoinBalance?.() || 0;
        const walletInfo = this.app.honeyData?.getWechatWalletBalanceForRecharge?.() || { available: false, initialized: false, balance: 0 };
        const walletText = walletInfo.available
            ? (walletInfo.initialized ? `¥${this._formatMoneyDisplay(walletInfo.balance)}` : '未初始化')
            : '未加载微信';
        const bgVideoStatus = bgVideoUrl
            ? '背景已上传'
            : '当前未设置动态背景。';
        const useHoneyWorldbook = window.VirtualPhone?.worldbookManager?.getEnabled?.('honey') ?? false;
        const honeyAutoImageRaw = this.app?.storage?.get?.('phone-image-honey-auto-generate');
        const useHoneyAutoImage = honeyAutoImageRaw === true || honeyAutoImageRaw === 'true';

        const html = `
            <div class="honey-app honey-page-settings">
                <div class="honey-nav">
                    <button class="honey-back-btn" id="honey-back-from-settings"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="honey-nav-title">❤️</div>
                    <button class="honey-icon-btn" id="honey-settings-dummy" title="设置"><i class="fa-solid fa-gear"></i></button>
                </div>

                <div class="honey-content honey-settings-content">
                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">账户与资产</div>
                        <div class="honey-settings-label">观众昵称</div>
                        <div class="honey-settings-inline">
                            <input type="text" id="honey-user-nickname" class="honey-settings-input" maxlength="20" value="${this._escapeHtml(honeyNickname)}" placeholder="输入观众昵称">
                            <button class="honey-settings-btn honey-settings-btn-muted honey-settings-inline-btn" id="honey-save-nickname">保存</button>
                        </div>
                        <div class="honey-settings-row">
                            <div>
                                <div class="honey-settings-label">金币余额</div>
                                <div class="honey-settings-desc">直播间打赏会扣除金币，1元=10金币。</div>
                            </div>
                            <div class="honey-coin-balance" id="honey-coin-balance">${this._formatCoinDisplay(honeyCoinBalance)}</div>
                        </div>
                        <div class="honey-settings-row">
                            <button class="honey-settings-btn honey-settings-btn-primary honey-settings-inline-btn" id="honey-open-recharge" style="margin-left: auto;">充值金币</button>
                            <button class="honey-settings-btn honey-settings-btn-muted honey-settings-inline-btn" id="honey-open-withdraw">提现到微信</button>
                        </div>
                    </div>

                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">动态背景 (推荐)</div>
                        <div class="honey-settings-desc">上传短视频(MP4/WebM)作为推荐页动态壁纸，最大 20MB。</div>
                        <div class="honey-settings-desc">${bgVideoStatus}</div>
                        <input type="file" id="honey-bg-video-upload" accept="video/mp4,video/webm" style="display: none;">
                        <div class="honey-settings-actions">
                            <label for="honey-bg-video-upload" class="honey-settings-btn honey-settings-btn-primary" style="display: flex; align-items: center; justify-content: center; cursor: pointer;">
                                <i class="fa-solid fa-video" style="margin-right: 6px;"></i> 上传视频
                            </label>
                            <button class="honey-settings-btn honey-settings-btn-muted" id="honey-delete-bg-video">恢复默认</button>
                        </div>
                    </div>

                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">直播背景 (直播)</div>
                        <div class="honey-settings-desc">上传短视频(MP4/WebM)，直播间会从中随机抽取播放。单文件最大 20MB。</div>

                        <div id="honey-custom-video-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                            <!-- JS 会动态填充这里的列表 -->
                        </div>

                        <input type="file" id="honey-live-video-upload" accept="video/mp4,video/webm" style="display: none;">
                        <div class="honey-settings-actions">
                            <label for="honey-live-video-upload" class="honey-settings-btn honey-settings-btn-primary" style="display: flex; align-items: center; justify-content: center; cursor: pointer;">
                                <i class="fa-solid fa-video" style="margin-right: 6px;"></i> 上传视频
                            </label>
                        </div>
                    </div>

                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">生成上下文</div>
                        <div class="honey-settings-row">
                            <div>
                                <div class="honey-settings-label">使用酒馆世界书</div>
                                <div class="honey-settings-desc">开启后，蜜语生成会注入下方勾选的酒馆世界书；不受酒馆启用状态影响。</div>
                            </div>
                            <label class="honey-toggle-switch">
                                <input type="checkbox" id="phone-honey-use-worldbook" ${useHoneyWorldbook ? 'checked' : ''}>
                                <span class="honey-toggle-slider"></span>
                            </label>
                        </div>
                        <div class="phone-prompt-fold honey-worldbook-fold" data-default-open="false" style="margin-top: 10px;">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">世界书选择</div>
                                    <div class="phone-prompt-fold-desc">展开后勾选要注入的酒馆世界书</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                <div id="phone-honey-worldbook-list" class="phone-honey-worldbook-list">
                                    <div class="honey-settings-desc" style="padding-top: 8px;">正在读取当前可用世界书...</div>
                                </div>
                            </div>
                        </div>
                        <div class="honey-settings-row">
                            <div>
                                <div class="honey-settings-label">直播自动生图</div>
                                <div class="honey-settings-desc">开启后，直播剧情刷新出新 NAI tag 时，会清空旧图并自动生成新直播图。</div>
                            </div>
                            <label class="honey-toggle-switch">
                                <input type="checkbox" id="phone-image-honey-auto-generate" ${useHoneyAutoImage ? 'checked' : ''}>
                                <span class="honey-toggle-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">提示词设置</div>
                        <div class="phone-prompt-fold" data-default-open="false" style="margin-top: 10px;">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">${this._escapeHtml(overridePromptConfig.name || '蜜语破限词')}</div>
                                    <div class="phone-prompt-fold-desc">${this._escapeHtml(overridePromptConfig.description || '蜜语看直播和自己开播请求开头注入')}</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('honey', 'override') || ''}
                                <textarea id="honey-override-prompt-editor" class="honey-prompt-editor">${this._escapeHtml(overridePromptConfig.content || '')}</textarea>
                            </div>
                        </div>
                        <div class="phone-prompt-fold" data-default-open="false">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">${this._escapeHtml(promptConfig.name || '蜜语直播/视频')}</div>
                                    <div class="phone-prompt-fold-desc">${this._escapeHtml(promptConfig.description || '蜜语APP直播与视频生成规则')}</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('honey', 'live') || ''}
                                <textarea id="honey-prompt-editor" class="honey-prompt-editor">${this._escapeHtml(promptConfig.content || '')}</textarea>
                            </div>
                        </div>
                        <div class="phone-prompt-fold" data-default-open="false" style="margin-top: 10px;">
                            <div class="phone-prompt-fold-header">
                                <div class="phone-prompt-fold-main">
                                    <div class="phone-prompt-fold-title">${this._escapeHtml(userLivePromptConfig.name || '蜜语用户开播')}</div>
                                    <div class="phone-prompt-fold-desc">${this._escapeHtml(userLivePromptConfig.description || '用户自己开播时的 JSON 输出规则')}</div>
                                </div>
                                <i class="fa-solid fa-chevron-right phone-prompt-fold-arrow"></i>
                            </div>
                            <div class="phone-prompt-fold-content">
                                ${promptManager?.renderPromptPresetControls?.('honey', 'userLive') || ''}
                                <textarea id="honey-user-live-prompt-editor" class="honey-prompt-editor">${this._escapeHtml(userLivePromptConfig.content || '')}</textarea>
                                <div class="honey-settings-actions">
                                    <button class="honey-settings-btn honey-settings-btn-muted" id="honey-reset-prompt">恢复默认</button>
                                    <button class="honey-settings-btn honey-settings-btn-primary" id="honey-save-prompt">保存提示词</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="honey-settings-card">
                        <div class="honey-settings-card-title">数据清理</div>
                        <div class="honey-settings-desc">清空蜜语已生成的推荐、直播缓存与聊天中的 Honey 标签内容。</div>
                        <button class="honey-settings-btn honey-settings-btn-danger" id="honey-clear-data">一键清理蜜语内容</button>
                    </div>
                </div>

                <div class="honey-recharge-modal" id="honey-recharge-modal">
                    <div class="honey-recharge-backdrop" data-action="close-recharge"></div>
                    <div class="honey-recharge-panel">
                        <div class="honey-recharge-title">金币充值</div>
                        <div class="honey-settings-desc">微信钱包余额：<span id="honey-recharge-wallet" class="honey-recharge-wallet-value">${this._escapeHtml(walletText)}</span></div>
                        <div class="honey-settings-desc">当前金币：<span id="honey-recharge-coins">${this._formatCoinDisplay(honeyCoinBalance)}</span></div>
                        <div class="honey-settings-label" style="margin-top: 10px;">充值金额（元）</div>
                        <input type="number" id="honey-recharge-yuan" class="honey-settings-input" min="0.1" step="0.1" placeholder="例如 10">
                        <div class="honey-settings-desc">预计到账：<span id="honey-recharge-preview" class="honey-recharge-preview-value">0</span> 金币</div>
                        <div class="honey-settings-actions">
                            <button class="honey-settings-btn honey-settings-btn-muted" id="honey-cancel-recharge">取消</button>
                            <button class="honey-settings-btn honey-settings-btn-primary" id="honey-confirm-recharge">立即充值</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'honey-settings');
        this._applyPhoneChromeTheme();
        this.bindSettingsEvents();
        this.renderHoneyWorldbookList();
    }

    _openWechatChatFromHoney(chatId) {
        const safeChatId = String(chatId || '').trim();
        if (!safeChatId) return;
        this.removePhoneChromeTheme();

        window.dispatchEvent(new CustomEvent('phone:openApp', {
            detail: { appId: 'wechat' }
        }));

        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            const wechatApp = window.VirtualPhone?.wechatApp || window.currentWechatApp || window.ggp_currentWechatApp;
            if (wechatApp?.openChat && wechatApp?.wechatData?.getChat?.(safeChatId)) {
                clearInterval(timer);
                wechatApp.openChat(safeChatId);
                return;
            }
            if (attempts >= 20) {
                clearInterval(timer);
            }
        }, 150);
    }

    _showHostWechatFriendRejectDialog(hostName = '', message = '') {
        const safeHostName = String(hostName || '').trim() || '主播';
        const safeMessage = String(message || '').trim() || '先不用加微信了。';
        const root = document.querySelector('.phone-view-current .honey-page-follow')
            || document.querySelector('.honey-page-follow')
            || document.querySelector('.phone-view-current')
            || document.body;
        root.querySelector('#honey-host-wechat-reject-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'honey-host-wechat-reject-modal';
        modal.className = 'honey-live-collab-modal honey-host-wechat-reject-modal';
        modal.innerHTML = `
            <button class="honey-live-collab-modal-backdrop" type="button" data-action="close-host-wechat-reject" aria-label="关闭"></button>
            <div class="honey-live-collab-modal-panel honey-host-wechat-reject-panel" role="dialog" aria-modal="true" aria-label="主播回复">
                <div class="honey-live-collab-modal-head">
                    <div class="honey-live-collab-modal-title">${this._escapeHtml(safeHostName)}</div>
                    <button class="honey-live-collab-modal-close" type="button" data-action="close-host-wechat-reject" aria-label="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="honey-host-wechat-reject-text">${this._escapeHtml(safeMessage)}</div>
                <button class="honey-host-wechat-reject-ok" type="button" data-action="close-host-wechat-reject">知道了</button>
            </div>
        `;
        const close = () => modal.remove();
        modal.querySelectorAll('[data-action="close-host-wechat-reject"]').forEach(el => {
            el.addEventListener('click', close);
        });
        root.appendChild(modal);
    }

    _renderCustomVideoList() {
        const currentView = document.querySelector('.phone-view-current') || document;
        const settingsRoot = currentView.querySelector('.honey-page-settings') || document.querySelector('.honey-page-settings');
        const container = settingsRoot?.querySelector?.('#honey-custom-video-list');
        if (!container) return;

        const videos = this.app.honeyData?.getCustomLiveVideos?.() || [];
        const isCollapsible = videos.length >= 2;
        const hiddenCount = videos.length;
        const visibleVideos = (isCollapsible && !this._customVideoListExpanded)
            ? []
            : videos;

        container.classList.toggle('is-expanded', isCollapsible && this._customVideoListExpanded);

        if (videos.length === 0) {
            container.classList.remove('is-expanded');
            container.innerHTML = '<div class="honey-custom-video-empty">当前视频池为空，将使用纯黑背景。</div>';
            return;
        }

        let html = '';
        visibleVideos.forEach((url, idx) => {
            const filename = (String(url || '').split('/').pop() || `视频 ${idx + 1}`);
            const safeFilename = this._escapeHtml(filename);
            const safeUrlAttr = this._escapeHtml(String(url || ''));
            html += `
            <div class="honey-custom-video-item">
                <span class="honey-custom-video-name"><i class="fa-regular fa-file-video honey-custom-video-icon"></i>${safeFilename}</span>
                <button class="honey-delete-custom-video-btn" data-url="${safeUrlAttr}"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        });

        if (isCollapsible && !this._customVideoListExpanded) {
            html += `<div class="honey-custom-video-hint">已折叠，共 ${hiddenCount} 条</div>`;
        }

        if (isCollapsible) {
            html += `
            <button id="honey-custom-video-toggle-btn" class="honey-custom-video-toggle-btn">
                ${this._customVideoListExpanded ? '收起列表' : `展开全部 (${videos.length})`}
            </button>
        `;
        }

        container.innerHTML = html;

        // 绑定删除按钮事件
        container.querySelectorAll('.honey-delete-custom-video-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetUrl = e.currentTarget.dataset.url;
                if (confirm('确定要从视频池中移除该视频吗？')) {
                    this.app.honeyData?.removeCustomLiveVideo?.(targetUrl);
                    if ((this.app.honeyData?.getCustomLiveVideos?.() || []).length < 2) {
                        this._customVideoListExpanded = false;
                    }
                    this._renderCustomVideoList(); // 局部刷新列表
                    this.app.phoneShell.showNotification('已移除', '视频已从随机池中删除', '🗑️');
                }
            });
        });

        container.querySelector('#honey-custom-video-toggle-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._customVideoListExpanded = !this._customVideoListExpanded;
            this._renderCustomVideoList();
        });
    }

    bindRecommendEvents() {
        const root = document.querySelector('.phone-view-current .honey-page-recommend') || document.querySelector('.honey-page-recommend');
        if (!root) return;
        const bgVideo = root.querySelector('#honey-bg-video-el');
        this._ensureRecommendVideoAutoplay(bgVideo);
        this._bindRecommendTopicEntries(root);
        this._bindRecommendPullRefresh();
        this._syncRecommendRefreshIndicatorByState();
        if (root.dataset.honeyRecommendBound === '1') return;
        root.dataset.honeyRecommendBound = '1';

        root.querySelector('#honey-back')?.addEventListener('click', () => {
            this._silenceRecommendSpeaker();
            this.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        root.querySelector('#honey-settings-btn')?.addEventListener('click', () => {
            this._silenceRecommendSpeaker();
            this.openSettings();
        });
        root.querySelector('#honey-recommend-search-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._openRecommendSearchModal();
        });

        root.querySelector('#honey-tab-live')?.addEventListener('click', () => {
            this._silenceRecommendSpeaker();
            this.enterLiveFromTopic(this._getDirectLiveTopic(), { autoGenerateIfMissing: false, backTarget: 'home' });
        });
        root.querySelector('#honey-tab-follow')?.addEventListener('click', () => {
            this._silenceRecommendSpeaker();
            this.currentPage = 'follow';
            this.render();
        });
        root.querySelector('#honey-tab-mine')?.addEventListener('click', () => {
            this._silenceRecommendSpeaker();
            this.currentPage = 'mine';
            this.render();
        });

        const soundBtn = root.querySelector('#honey-bg-sound-btn');
        if (soundBtn && bgVideo) {
            soundBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (bgVideo.muted) {
                    bgVideo.muted = false;
                    bgVideo.volume = 0.6;
                    soundBtn.innerHTML = '<i class="fa-solid fa-volume-high" style="color: #ff4785;"></i>';
                } else {
                    bgVideo.muted = true;
                    soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
                }
            });
        }
    }

    _bindGeneratedImageViewer(root = null) {
        const scope = root || document.querySelector('.phone-view-current .honey-page-live') || document.querySelector('.honey-page-live');
        if (!scope) return;
        scope.querySelectorAll('.honey-nai-generated-image').forEach(img => {
            if (img.dataset.honeyImageViewerBound === '1') return;
            img.dataset.honeyImageViewerBound = '1';
            const openViewer = (target) => {
                const imageUrl = target?.getAttribute?.('src') || '';
                if (!imageUrl) return;
                const hostName = String(this.currentSceneData?.host || 'honey').trim() || 'honey';
                const seed = String(this.currentSceneData?.imageGenerationSeed || Date.now()).trim();
                this.app?.phoneShell?.showImageViewer?.(imageUrl, {
                    alt: '蜜语直播图片',
                    download: true,
                    filename: `honey_${hostName}_${seed}.png`
                });
            };
            img.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            img.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openViewer(e.currentTarget);
            });
            img.addEventListener('pointerup', (e) => {
                e.stopPropagation();
                const now = Date.now();
                const lastTap = Number(e.currentTarget?.dataset?.honeyImageViewerLastTap || 0);
                e.currentTarget.dataset.honeyImageViewerLastTap = String(now);
                if (now - lastTap <= 320) {
                    e.preventDefault();
                    openViewer(e.currentTarget);
                }
            });
        });
    }

    bindLiveEvents() {
        const root = document.querySelector('.phone-view-current .honey-page-live') || document.querySelector('.honey-page-live');
        if (!root) return;
        const isUserLive = this._isUserLiveScene(this.currentSceneData || this.selectedTopic);
        this._bindLivePullRefresh(root, isUserLive);
        this._syncLiveRefreshIndicatorByState(root);
        this._bindGeneratedImageViewer(root);
        if (root.dataset.honeyLiveBound === '1') return;
        root.dataset.honeyLiveBound = '1';
        this._bindLiveKeyboardViewport(root);

        const getLiveInput = () => root.querySelector('#honey-chat-input');
        root.querySelectorAll('[data-action="close-live-visibility"]').forEach(el => {
            el.addEventListener('click', () => {
                this._liveVisibilityModalOpen = false;
                this.render();
            });
        });
        root.querySelector('[data-action="start-private-live"]')?.addEventListener('click', () => {
            this._startMyLiveWithVisibility('private');
        });
        root.querySelector('[data-action="start-public-live"]')?.addEventListener('click', () => {
            this._startMyLiveWithVisibility('public');
        });
        const clearLiveBatchTimer = () => {
            clearTimeout(this._liveBatchTimer);
            this._liveBatchTimer = null;
        };
        const syncLiveStatusDot = () => {
            this._syncLiveStatusDot(root);
        };
        const restartLivePendingTimerIfNeeded = () => {
            const input = getLiveInput();
            const text = String(input?.value || '').trim();
            const isEditing = !!input && document.activeElement === input;
            const canRestart = !isEditing
                && text === ''
                && Array.isArray(this._livePendingUserLines)
                && this._livePendingUserLines.length > 0
                && !this._liveSendInFlight
                && !this._isGeneratingScene
                && !this._isGiftPickerOpen;
            if (!canRestart) {
                if (text !== '' || isEditing || this._isGeneratingScene) {
                    clearLiveBatchTimer();
                }
                syncLiveStatusDot();
                return;
            }
            clearLiveBatchTimer();
            this._liveBatchTimer = setTimeout(() => {
                flushPendingLiveMessages();
            }, 6000);
            syncLiveStatusDot();
        };
        const flushPendingLiveMessages = async () => {
            if (this._liveSendInFlight || this._isGeneratingScene) return;
            if (!Array.isArray(this._livePendingUserLines) || this._livePendingUserLines.length === 0) return;
            if (!this._isHoneyLiveEnabled()) {
                this.app.phoneShell.showNotification('蜜语已关闭', '请先在设置中开启蜜语功能', '⚠️');
                clearLiveBatchTimer();
                this._livePendingUserLines = [];
                this._livePendingDisplayLines = [];
                this._refreshLivePageDom({ sourceRoot: root, scene: this.currentSceneData });
                syncLiveStatusDot();
                return;
            }

            this._liveSendInFlight = true;
            clearLiveBatchTimer();
            syncLiveStatusDot();

            const combinedMessage = this._livePendingUserLines.join('\n');
            this._livePendingUserLines = [];
            const input = getLiveInput();
            const prevPlaceholder = String(input?.placeholder || '');
            if (input) {
                input.value = '';
                input.disabled = true;
                input.placeholder = 'AI 正在根据你的弹幕推进剧情...';
            }

            try {
                await this._generateCurrentTopicScene({
                    resetSession: false,
                    notify: false,
                    sourceRoot: root,
                    userMessage: combinedMessage
                });
            } catch (err) {
                console.error('蜜语互动续写失败:', err);
                this.app.phoneShell.showNotification('错误', err.message || String(err), '❌');
            } finally {
                this._livePendingDisplayLines = [];
                if (input) {
                    input.disabled = false;
                    input.placeholder = prevPlaceholder || '输入后回车发送弹幕...';
                }
                this._liveSendInFlight = false;
                if (Array.isArray(this._livePendingUserLines) && this._livePendingUserLines.length > 0) {
                    restartLivePendingTimerIfNeeded();
                } else {
                    this._refreshLivePageDom({ sourceRoot: root, scene: this.currentSceneData });
                    syncLiveStatusDot();
                }
            }
        };

        root.querySelector('#honey-back')?.addEventListener('click', () => {
            this._silenceLiveSpeaker();
            this._navigateBackFromLive();
        });

        root.querySelector('#honey-tab-recommend')?.addEventListener('click', () => {
            this._silenceLiveSpeaker();
            this.currentPage = 'recommend';
            this.render();
        });
        root.querySelector('#honey-tab-follow')?.addEventListener('click', () => {
            this._silenceLiveSpeaker();
            this.currentPage = 'follow';
            this.render();
        });
        root.querySelector('#honey-tab-mine')?.addEventListener('click', () => {
            this._silenceLiveSpeaker();
            this.currentPage = 'mine';
            this.render();
        });
        root.querySelector('#honey-settings-btn')?.addEventListener('click', () => {
            this._silenceLiveSpeaker();
            this.openSettings();
        });
        root.querySelector('.honey-follow-btn')?.addEventListener('click', () => {
            if (isUserLive) return;
            const followBtn = root.querySelector('.honey-follow-btn');
            const hostName = String(followBtn?.dataset?.hostName || this.currentSceneData?.host || '')
                .replace(/\s*[（(]\s*(?:已关注|未关注)\s*[)）]\s*$/g, '')
                .trim();
            if (!hostName) return;
            const avatarUrl = String(followBtn?.dataset?.avatarUrl || '').trim();
            const result = this.app?.honeyData?.toggleFollowHost?.(hostName, avatarUrl, {
                scene: this.currentSceneData || this.selectedTopic || {},
                liveTitle: this.currentSceneData?._topicTitle || this.currentSceneData?.title || this.selectedTopic?._topicTitle || this.selectedTopic?.title || '',
                intro: this.currentSceneData?.intro || this.selectedTopic?.intro || '',
                fans: this.currentSceneData?.fans || this.selectedTopic?.fans || ''
            });
            const isFollowed = !!result?.followed;
            this._setFollowButtonState(followBtn, isFollowed);
            this._persistCurrentScene();
            this.app.phoneShell.showNotification('蜜语', isFollowed ? `已关注 ${hostName}` : `已取消关注 ${hostName}`, isFollowed ? '✅' : 'ℹ️');
        });
        const rankMini = root.querySelector('#honey-live-rank-mini');
        if (rankMini) {
            const toggleRankMini = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._isLiveRankExpanded = !this._isLiveRankExpanded;
                rankMini.classList.toggle('is-expanded', this._isLiveRankExpanded);
                rankMini.setAttribute('aria-expanded', this._isLiveRankExpanded ? 'true' : 'false');
                rankMini.setAttribute('title', this._isLiveRankExpanded ? '点击收起榜单' : '点击展开榜单');
            };
            rankMini.addEventListener('click', toggleRankMini);
            rankMini.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    toggleRankMini(e);
                }
            });
        }
        this._bindViewerLiveCollabButton(root, isUserLive);
        this._bindLiveTurnRetryButton(root);
        const sceneToggleBtn = root.querySelector('#honey-scene-toggle-btn');
        if (sceneToggleBtn) {
            let lastSceneToggleTs = 0;
            sceneToggleBtn.onpointerup = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const now = Date.now();
                if (now - lastSceneToggleTs < 120) return;
                lastSceneToggleTs = now;
                const liveInputState = this._captureLiveChatInputState(root);
                this.isScenePanelOpen = !this.isScenePanelOpen;
                if (!this.isScenePanelOpen) {
                    this._isSceneTagHistoryOpen = false;
                }
                this.render();
                this._restoreLiveChatInputState(liveInputState);
            };
            // 屏蔽 touch 产生的合成 click，避免重复触发
            sceneToggleBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
        }

        root.querySelector('#honey-end-live-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._isGeneratingScene) {
                this.app.phoneShell.showNotification('蜜语', '剧情生成中，请稍后再结束直播', '⏳');
                return;
            }
            this._showUserLiveSettlementDialog();
        });

        const closeSceneModal = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (!this.isScenePanelOpen) return;
            const liveInputState = this._captureLiveChatInputState(root);
            this.isScenePanelOpen = false;
            this._isSceneTagHistoryOpen = false;
            this.render();
            this._restoreLiveChatInputState(liveInputState);
        };
        root.querySelector('#honey-scene-modal-close-btn')?.addEventListener('click', closeSceneModal);
        root.querySelector('#honey-scene-modal-backdrop')?.addEventListener('click', closeSceneModal);
        root.querySelector('#honey-scene-modal-card')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        const sceneTagBtn = root.querySelector('#honey-scene-tag-history-btn');
        const closeSceneTagHistory = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            this._isSceneTagHistoryOpen = false;
            const liveInputState = this._captureLiveChatInputState(root);
            this.render();
            this._restoreLiveChatInputState(liveInputState);
        };
        if (sceneTagBtn) {
            sceneTagBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._isSceneTagHistoryOpen = true;
                const liveInputState = this._captureLiveChatInputState(root);
                this.render();
                this._restoreLiveChatInputState(liveInputState);
            });
        }
        root.querySelector('#honey-scene-tag-history-close')?.addEventListener('click', closeSceneTagHistory);
        root.querySelector('#honey-scene-tag-history-backdrop')?.addEventListener('click', closeSceneTagHistory);
        root.querySelector('#honey-scene-tag-history-retag')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._retagCurrentSceneNaiPrompt(root);
        });
        root.querySelector('#honey-scene-tag-history-panel')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        root.addEventListener('click', (e) => {
            const actionEl = e.target?.closest?.('[data-live-collab-action]');
            if (!actionEl || !root.contains(actionEl)) return;
            const action = String(actionEl.dataset.liveCollabAction || '').trim();
            if (!action) return;
            e.preventDefault();
            e.stopPropagation();

            if (action === 'dismiss') {
                this._dismissLiveCollabRequestModal();
                return;
            }
            if (action === 'accept') {
                this._acceptLiveCollabRequest(String(actionEl.dataset.requestKey || '').trim());
                return;
            }
            if (action === 'prompt-end-collab') {
                this._openLiveCollabEndConfirm();
                return;
            }
            if (action === 'cancel-end-collab') {
                this._closeLiveCollabEndConfirm();
                return;
            }
            if (action === 'confirm-end-collab') {
                this._endCurrentLiveCollab();
            }
        });

        // 🔥 新增：弹幕区域点击展开/收起交互
        const giftsWrap = root.querySelector('#honey-live-gifts');
        if (giftsWrap) {
            giftsWrap.addEventListener('click', (e) => {
                e.stopPropagation();
                giftsWrap.classList.toggle('is-expanded');
                
                // 当展开时，自动把滚动条拉到底部，让用户优先看到最新的弹幕
                if (giftsWrap.classList.contains('is-expanded')) {
                    const listEl = giftsWrap.querySelector('.honey-live-gifts-list');
                    if (listEl) {
                        setTimeout(() => {
                            listEl.scrollTop = listEl.scrollHeight;
                        }, 50);
                    }
                }
            });
        }

        const liveInput = getLiveInput();
        liveInput?.addEventListener('focus', () => {
            clearLiveBatchTimer();
            syncLiveStatusDot();
        });
        liveInput?.addEventListener('blur', () => {
            restartLivePendingTimerIfNeeded();
        });
        liveInput?.addEventListener('input', (e) => {
            const text = String(e.target.value || '').trim();
            if (text !== '') {
                clearLiveBatchTimer();
                syncLiveStatusDot();
                return;
            }
            if (document.activeElement === e.target) {
                syncLiveStatusDot();
                return;
            }
            restartLivePendingTimerIfNeeded();
        });
        liveInput?.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            e.preventDefault();

            const input = e.currentTarget;
            const text = String(input.value || '').trim();

            if (text) {
                if (!this._isHoneyLiveEnabled()) {
                    this.app.phoneShell.showNotification('蜜语已关闭', '请先在设置中开启蜜语功能', '⚠️');
                    return;
                }
                if (this._isGeneratingScene || this._liveSendInFlight) return;

                this._livePendingUserLines.push(text);
                const sceneForUserLine = this.currentSceneData || this.selectedTopic || {};
                const isUserLiveLine = this._isUserLiveScene(sceneForUserLine);
                const profile = isUserLiveLine ? (this.app?.honeyData?.getHoneyUserProfile?.() || {}) : {};
                const speakerName = String(
                    isUserLiveLine
                        ? (profile.nickname || this.app?.honeyData?.getHoneyUserNickname?.() || '你')
                        : (this.app?.honeyData?.getHoneyUserNickname?.() || '你')
                ).trim() || '你';
                this._livePendingDisplayLines.push(`${speakerName}：${text}`);
                const liveInputState = this._captureLiveChatInputState(root);
                input.value = '';
                this._refreshLivePageDom({ sourceRoot: root, scene: this.currentSceneData });
                this._restoreLiveChatInputState({
                    ...liveInputState,
                    value: '',
                    selectionStart: 0,
                    selectionEnd: 0
                });

                if (document.activeElement === input) {
                    clearLiveBatchTimer();
                    syncLiveStatusDot();
                } else {
                    restartLivePendingTimerIfNeeded();
                }
                return;
            }

            if (Array.isArray(this._livePendingUserLines) && this._livePendingUserLines.length > 0) {
                await flushPendingLiveMessages();
                return;
            }
        });
        if (Array.isArray(this._livePendingUserLines) && this._livePendingUserLines.length > 0) {
            restartLivePendingTimerIfNeeded();
        } else {
            syncLiveStatusDot();
        }

        const sceneTtsBtn = root.querySelector('#honey-scene-tts-btn');
        if (sceneTtsBtn) {
            const audio = this._honeyTtsAudio;
            if (audio && !audio.paused) {
                this._honeyTtsPlayingBtn = sceneTtsBtn;
                this._setHoneyTtsButtonState(sceneTtsBtn, 'playing');
            } else {
                this._setHoneyTtsButtonState(sceneTtsBtn, 'idle');
            }

            sceneTtsBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this._isGeneratingScene) {
                    this.app?.phoneShell?.showNotification?.('蜜语', '剧情生成中，请稍后再播放语音', '⏳');
                    return;
                }

                const enabled = !!this.app?.storage?.get?.('phone-honey-tts-enabled');
                if (!enabled) {
                    this.app?.phoneShell?.showNotification?.('蜜语语音', '请先在设置 > 语音 TTS > 蜜语直播中开启', '⚠️');
                    return;
                }

                const currentAudio = this._honeyTtsAudio;
                if (this._honeyTtsPlayingBtn === sceneTtsBtn && currentAudio && !currentAudio.paused) {
                    this._stopHoneyTtsPlayback();
                    return;
                }

                const modeRaw = String(this.app?.storage?.get?.('phone-honey-tts-mode') || 'full').trim().toLowerCase();
                const mode = modeRaw === 'quotes' ? 'quotes' : 'full';
                const sceneTextRaw = this._resolveCurrentSceneSpeechText(root);
                const speechText = mode === 'quotes'
                    ? this._extractHoneyQuotedSpeech(sceneTextRaw)
                    : this._normalizeHoneySpeechText(sceneTextRaw);

                if (!speechText) {
                    const tips = mode === 'quotes'
                        ? '当前剧情里没有可播报的“引号内容”'
                        : '当前剧情文本为空，无法播放';
                    this.app?.phoneShell?.showNotification?.('蜜语语音', tips, 'ℹ️');
                    return;
                }

                try {
                    await this._playHoneySceneTts(speechText, sceneTtsBtn);
                } catch (err) {
                    this._setHoneyTtsButtonState(sceneTtsBtn, 'idle');
                    this.app?.phoneShell?.showNotification?.('蜜语语音', err?.message || '播放失败', '❌');
                }
            });
        }

        const giftBtn = root.querySelector('#honey-gift-btn');
        const giftPicker = root.querySelector('#honey-gift-picker');

        const setGiftPickerOpen = (open) => {
            if (!giftPicker) return;
            const isOpen = !!open;
            this._isGiftPickerOpen = isOpen;
            giftPicker.classList.toggle('show', isOpen);
            root.classList.toggle('is-gift-picker-open', isOpen);
            // 样式兜底：即使 CSS 未生效，也能通过 JS 强制开关面板
            giftPicker.style.display = isOpen ? 'grid' : 'none';
            giftPicker.style.pointerEvents = isOpen ? 'auto' : 'none';
            if (isOpen) {
                clearLiveBatchTimer();
            } else {
                restartLivePendingTimerIfNeeded();
            }
            syncLiveStatusDot();
        };

        // 初始关闭，避免历史层残留状态干扰
        setGiftPickerOpen(false);

        let lastToggleTs = 0;
        const toggleGiftPicker = (e) => {
            if (!giftPicker) return;
            e.preventDefault();
            e.stopPropagation();
            const now = Date.now();
            if (now - lastToggleTs < 120) return;
            lastToggleTs = now;
            const isOpen = giftPicker.classList.contains('show');
            setGiftPickerOpen(!isOpen);
        };

        if (giftBtn) {
            const supportsPointerEvent = typeof window !== 'undefined' && 'PointerEvent' in window;
            giftBtn.addEventListener(supportsPointerEvent ? 'pointerup' : 'click', toggleGiftPicker);
        }

        root.querySelectorAll('.honey-gift-option').forEach(el => {
            el.addEventListener('click', (e) => {
                if (isUserLive) return;
                const name = e.currentTarget?.dataset?.gift;
                if (!name) return;
                const liveInputState = this._captureLiveChatInputState(root);

                const qtyInput = window.prompt('送出数量（1-999）', '1');
                if (qtyInput === null) return; // 用户取消
                const parsedQty = Number.parseInt(String(qtyInput).trim(), 10);
                if (!Number.isInteger(parsedQty) || parsedQty < 1) return;
                const qty = Math.min(parsedQty, 999);
                const giftDef = (Array.isArray(this.giftOptions) ? this.giftOptions : [])
                    .find(item => String(item?.name || '').trim() === String(name).trim());
                const totalCost = Math.max(0, (Number(giftDef?.price) || 0) * qty);
                const consumeResult = this.app?.honeyData?.consumeHoneyCoins?.(totalCost) || { success: false, balanceBefore: 0, balanceAfter: 0 };
                if (!consumeResult.success) {
                    this.app.phoneShell.showNotification(
                        '金币不足',
                        `本次需${this._formatCoinDisplay(totalCost)}金币，当前仅${this._formatCoinDisplay(consumeResult.balanceBefore || 0)}金币`,
                        '⚠️'
                    );
                    return;
                }

                const senderName = this.app?.honeyData?.getHoneyUserNickname?.() || '你';
                this._pushLiveGift(`${senderName}送出 ${name} x${qty}（${totalCost}金币）`, {
                    senderName,
                    giftAmount: totalCost
                });
                this._restoreLiveChatInputState(liveInputState);
                this.app.phoneShell.showNotification(
                    '打赏成功',
                    `已扣除${this._formatCoinDisplay(totalCost)}金币，剩余${this._formatCoinDisplay(consumeResult.balanceAfter || 0)}金币`,
                    '✅'
                );
                setGiftPickerOpen(false);
            });
        });

        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
        }
        this._outsideClickHandler = (e) => {
            if (!giftPicker) return;
            const target = e.target;
            const inGift = giftPicker.contains(target) || (giftBtn && giftBtn.contains(target));
            if (!inGift) {
                setGiftPickerOpen(false);
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        root.querySelector('#honey-test-nai-btn')?.addEventListener('click', async () => {
            const scene = this.currentSceneData || {};
            const prompt = this._resolveSceneNaiPrompt(scene);
            if (!prompt) {
                this.app.phoneShell.showNotification('蜜语', '当前直播没有可用的 NAI 提示词', '⚠️');
                return;
            }
            this._generateSceneImageFromPrompt({ scene, prompt, auto: false });
        });

        const liveVideo = root.querySelector('#honey-live-video-el');
        const liveSoundBtn = root.querySelector('#honey-live-sound-btn');
        if (liveVideo) {
            liveVideo.muted = true;
            liveVideo.dataset.retryCount = '0';
            if (liveSoundBtn) {
                liveSoundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            }
            liveVideo.addEventListener('loadeddata', () => {
                liveVideo.dataset.retryCount = '0';
            });
            liveVideo.addEventListener('error', () => {
                const failedSrc = String(liveVideo.currentSrc || liveVideo.src || '').trim();
                const retryCount = Math.max(0, Number.parseInt(String(liveVideo.dataset.retryCount || '0'), 10) || 0);
                const data = this.currentSceneData || {};
                const rawPool = this.app?.honeyData?.getCustomLiveVideos?.() || [];
                const pool = [];
                const seen = new Set();
                rawPool.forEach((item) => {
                    const normalized = this._normalizeUploadedBackgroundUrl(item);
                    if (!normalized || seen.has(normalized)) return;
                    seen.add(normalized);
                    pool.push(normalized);
                });

                const normalizedCurrent = this._normalizeUploadedBackgroundUrl(failedSrc);
                const currentIndex = normalizedCurrent ? pool.indexOf(normalizedCurrent) : -1;
                const canRetry = pool.length > 1 && retryCount < (pool.length - 1);

                if (canRetry) {
                    const nextIndex = currentIndex >= 0
                        ? (currentIndex + 1) % pool.length
                        : (retryCount % pool.length);
                    const nextUrl = pool[nextIndex] || '';
                    if (nextUrl && nextUrl !== normalizedCurrent) {
                        liveVideo.dataset.retryCount = String(retryCount + 1);
                        liveVideo.src = nextUrl;
                        liveVideo.load();
                        this._playLiveVideoIfCurrent(liveVideo, root);
                        console.warn('蜜语直播视频加载失败，已切换候选源:', failedSrc || '(empty src)', '=>', nextUrl);
                        return;
                    }
                }

                // 最终仍失败：尝试根据当前场景重新挑选一次，再不行就提示重传
                const repickedUrl = this._buildLiveVideoUrl(data);
                if (repickedUrl && repickedUrl !== normalizedCurrent && retryCount < pool.length + 1) {
                    liveVideo.dataset.retryCount = String(retryCount + 1);
                    liveVideo.src = repickedUrl;
                    liveVideo.load();
                    this._playLiveVideoIfCurrent(liveVideo, root);
                    console.warn('蜜语直播视频加载失败，已重新挑选视频源:', failedSrc || '(empty src)', '=>', repickedUrl);
                    return;
                }

                console.warn('蜜语直播视频加载失败:', failedSrc || '(empty src)');
                this.app?.phoneShell?.showNotification?.('蜜语', '视频无法解码或地址失效，请重传 H.264 MP4', '⚠️');
            });
            this._playLiveVideoIfCurrent(liveVideo, root);
        }
        if (liveSoundBtn && liveVideo) {
            liveSoundBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (liveVideo.muted) {
                    liveVideo.muted = false;
                    liveVideo.volume = 0.6;
                    liveSoundBtn.innerHTML = '<i class="fa-solid fa-volume-high" style="color: #ff4785;"></i>';
                } else {
                    liveVideo.muted = true;
                    liveSoundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
                }
            });
        }
    }

    bindMineEvents() {
        const root = document.querySelector('.phone-view-current .honey-page-mine') || document.querySelector('.honey-page-mine');
        if (!root) return;
        if (root.dataset.honeyMineBound === '1') return;
        root.dataset.honeyMineBound = '1';

        const saveMineProfile = (patch = {}) => {
            const nicknameInput = root.querySelector('#honey-mine-live-nickname');
            const liveTitleInput = root.querySelector('#honey-mine-live-title');
            const introInput = root.querySelector('#honey-mine-intro');
            const genderInput = root.querySelector('#honey-mine-gender');
            const nextPatch = {
                nickname: nicknameInput?.value || '',
                liveTitle: liveTitleInput?.value || '',
                intro: introInput?.value || '',
                gender: genderInput?.value || 'female',
                ...patch
            };
            const profile = this.app?.honeyData?.saveHoneyUserProfile?.(nextPatch) || null;
            if (nicknameInput && typeof profile?.nickname === 'string') nicknameInput.value = profile.nickname;
            if (liveTitleInput && typeof profile?.liveTitle === 'string') liveTitleInput.value = profile.liveTitle;
            if (introInput && typeof profile?.intro === 'string') introInput.value = profile.intro;
            if (genderInput && typeof profile?.gender === 'string') genderInput.value = profile.gender;
            this._syncUserLiveProfileDisplay(profile, nextPatch);
            return profile;
        };

        root.querySelector('#honey-back')?.addEventListener('click', () => {
            this.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        root.querySelector('#honey-settings-btn')?.addEventListener('click', () => {
            this.openSettings();
        });
        const bindTap = (selector, handler) => {
            root.querySelectorAll(selector).forEach(el => {
                const run = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handler(e);
                };
                el.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                el.addEventListener('pointerup', (e) => {
                    el.dataset.lastPointerAt = String(Date.now());
                    run(e);
                });
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const lastPointerAt = Number(el.dataset.lastPointerAt || 0);
                    if (lastPointerAt && Date.now() - lastPointerAt < 500) return;
                    run(e);
                });
            });
        };
        bindTap('[data-action="close-live-visibility"]', () => this._hideLiveVisibilityModal());
        bindTap('[data-action="start-private-live"]', () => this._startMyLiveWithVisibility('private'));
        bindTap('[data-action="start-public-live"]', () => this._startMyLiveWithVisibility('public'));

        root.querySelector('#honey-tab-recommend')?.addEventListener('click', () => {
            this.currentPage = 'recommend';
            this.render();
        });
        root.querySelector('#honey-tab-live')?.addEventListener('click', () => {
            this.enterLiveFromTopic(this._getDirectLiveTopic(), { autoGenerateIfMissing: false, backTarget: 'home' });
        });
        root.querySelector('#honey-tab-follow')?.addEventListener('click', () => {
            this.currentPage = 'follow';
            this.render();
        });
        root.querySelector('#honey-tab-mine')?.addEventListener('click', () => {
            this.currentPage = 'mine';
            this.render();
        });

        root.querySelector('#honey-save-mine-profile')?.addEventListener('click', () => {
            const profile = saveMineProfile();
            this.app.phoneShell.showNotification('已保存', `${profile?.nickname || '直播账号'}设置已更新`, '✅');
            this.render();
        });
        root.querySelector('#honey-mine-live-nickname')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            root.querySelector('#honey-save-mine-profile')?.click();
        });
        root.querySelector('#honey-mine-live-title')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            root.querySelector('#honey-save-mine-profile')?.click();
        });
        root.querySelectorAll('.honey-mine-gender-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const nextGender = String(btn.dataset.gender || '').trim() === 'male' ? 'male' : 'female';
                const genderInput = root.querySelector('#honey-mine-gender');
                if (genderInput) genderInput.value = nextGender;
                root.querySelectorAll('.honey-mine-gender-btn').forEach((item) => {
                    const isActive = String(item.dataset.gender || '').trim() === nextGender;
                    item.classList.toggle('is-active', isActive);
                    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });
            });
        });

        const avatarBtn = root.querySelector('#honey-mine-avatar-btn');
        const avatarUploadInput = root.querySelector('#honey-mine-avatar-upload');
        avatarBtn?.addEventListener('click', () => {
            avatarUploadInput?.click();
        });
        avatarUploadInput?.addEventListener('change', async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            e.target.value = '';

            const mime = String(file.type || '').toLowerCase();
            const ext = mime.includes('png')
                ? 'png'
                : (mime.includes('webp')
                    ? 'webp'
                    : (mime.includes('gif')
                        ? 'gif'
                        : ((mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' : '')));
            if (!ext) {
                this.app.phoneShell.showNotification('提示', '请选择 PNG/JPG/WebP/GIF 图片', '⚠️');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                this.app.phoneShell.showNotification('提示', '头像图片不能超过 10MB', '⚠️');
                return;
            }

            this.app.phoneShell.showNotification('处理中', '正在上传直播头像...', '⏳');
            try {
                const uploadedUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(file, 'honey_user_avatar');
                if (!uploadedUrl) throw new Error('图片上传管理器未初始化');

                saveMineProfile({ avatarUrl: uploadedUrl });
                this.app.phoneShell.showNotification('头像已更新', '你的直播头像已保存', '✅');
                this.render();
            } catch (err) {
                console.error('蜜语头像上传失败:', err);
                this.app.phoneShell.showNotification('上传失败', err?.message || '头像上传失败', '❌');
            }
        });

        bindTap('#honey-start-my-live', () => {
            saveMineProfile();
            this._showLiveVisibilityModal();
        });

        root.addEventListener('click', (e) => {
            const actionEl = e.target?.closest?.('[data-action]');
            if (!actionEl) return;
            const action = String(actionEl.dataset.action || '').trim();
            const name = String(actionEl.dataset.name || '').trim();
            if (!name) return;

            if (action === 'accept-honey-friend') {
                const accepted = this.app?.honeyData?.acceptHoneyFriendRequest?.(name);
                if (accepted) {
                    this.app?.honeyData?.ensureHoneyAcceptedRequestWechatChat?.(accepted);
                    this.app.phoneShell.showNotification('已通过', `${accepted.name} 已加入好友列表并同步到微信`, '✅');
                }
                this.render();
                return;
            }

            if (action === 'open-honey-friend-chat') {
                const linked = this.app?.honeyData?.ensureHoneyAcceptedRequestWechatChat?.(name);
                if (linked?.chat?.id) {
                    this._openWechatChatFromHoney(linked.chat.id);
                } else {
                    this.app.phoneShell.showNotification('打开失败', '还没找到这个好友对应的微信聊天', '⚠️');
                }
                return;
            }

            if (action === 'remove-honey-friend') {
                const ok = confirm(`确定删除好友 ${name} 吗？\n\n会同时删除：\n1) 蜜语好友列表里的该好友\n2) 微信通讯录中的对应联系人\n3) 微信里与该好友的聊天记录`);
                if (!ok) return;
                const removed = this.app?.honeyData?.removeHoneyFriend?.(name);
                if (removed) {
                    this.app.phoneShell.showNotification('已删除', `${name} 的蜜语好友和微信记录已清除`, '🗑️');
                } else {
                    this.app.phoneShell.showNotification('删除失败', '没找到这个好友', '⚠️');
                }
                this.render();
                return;
            }

            if (action === 'reject-honey-friend') {
                this.app?.honeyData?.rejectHoneyFriendRequest?.(name);
                this.app.phoneShell.showNotification('已拒绝', `${name} 的好友申请已删除`, 'ℹ️');
                this.render();
            }
        });
    }

    _showLiveVisibilityModal() {
        this._liveVisibilityModalOpen = true;
        this._liveVisibilityModalOpenedAt = Date.now();
        this.renderMinePage();
    }

    _hideLiveVisibilityModal() {
        const openedAt = Number(this._liveVisibilityModalOpenedAt || 0);
        if (openedAt && Date.now() - openedAt < 420) return;
        this._liveVisibilityModalOpen = false;
        this.renderMinePage();
    }

    _startMyLiveWithVisibility(visibility = 'public') {
        const safeVisibility = String(visibility || '').trim() === 'private' ? 'private' : 'public';
        const activeIsLive = this.currentPage === 'live' && (this.currentSceneData || this.selectedTopic);
        this._liveVisibilityModalOpen = false;
        this._liveVisibilityModalOpenedAt = 0;
        if (activeIsLive) {
            this.currentSceneData = {
                ...(this.currentSceneData || this._buildBaseScene(this.selectedTopic || this._getFallbackTopic(), this._getActiveTopicTitle(), this._getActiveTopicKey())),
                visibility: safeVisibility,
                isPrivateLive: safeVisibility === 'private'
            };
            this.selectedTopic = {
                ...(this.selectedTopic || {}),
                visibility: safeVisibility,
                isPrivateLive: safeVisibility === 'private'
            };
            if (safeVisibility === 'private') {
                this.currentSceneData.comments = [];
            }
            this._persistCurrentScene();
            this.render();
            return;
        }

        const profile = this.app?.honeyData?.getHoneyUserProfile?.() || {};
        const topic = {
            ...this._getUserLiveTopic(profile),
            visibility: safeVisibility,
            isPrivateLive: safeVisibility === 'private'
        };
        this.enterLiveFromTopic(topic, {
            autoGenerateIfMissing: false,
            backTarget: 'mine',
            visibility: safeVisibility
        });
    }

    bindPlaceholderEvents() {
        const root = document.querySelector('.phone-view-current .honey-page-follow')
            || document.querySelector('.honey-page-follow')
            || document.querySelector('.phone-view-current .honey-page-placeholder')
            || document.querySelector('.honey-page-placeholder');
        if (!root) return;
        if (root.dataset.honeyPlaceholderBound === '1') return;
        root.dataset.honeyPlaceholderBound = '1';
        const isFollowPage = root.classList.contains('honey-page-follow');

        root.querySelector('#honey-back')?.addEventListener('click', () => {
            this.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        root.querySelector('#honey-settings-btn')?.addEventListener('click', () => {
            this.openSettings();
        });

        root.querySelector('#honey-tab-recommend')?.addEventListener('click', () => {
            this.currentPage = 'recommend';
            this.render();
        });
        root.querySelector('#honey-tab-live')?.addEventListener('click', () => {
            this.enterLiveFromTopic(this._getDirectLiveTopic(), { autoGenerateIfMissing: false, backTarget: 'home' });
        });
        root.querySelector('#honey-tab-follow')?.addEventListener('click', () => {
            this.currentPage = 'follow';
            this.render();
        });
        root.querySelector('#honey-tab-mine')?.addEventListener('click', () => {
            this.currentPage = 'mine';
            this.render();
        });

        if (!isFollowPage) return;

        const closeFollowVideoModal = () => {
            const modal = root.querySelector('#honey-follow-video-modal');
            if (!modal) return;
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            const list = modal.querySelector('#honey-follow-video-modal-list');
            if (list) list.innerHTML = '';
        };

        root.addEventListener('change', async (e) => {
            const input = e.target?.closest?.('.honey-follow-reference-upload');
            if (!input) return;
            const hostName = String(input.dataset.hostName || '').trim();
            const file = input.files?.[0] || null;
            input.value = '';
            if (!hostName || !file) return;

            try {
                const uploadedUrl = await this._uploadHoneyReferenceImageFile(hostName, file);
                const updated = this.app?.honeyData?.updateFollowedHostNaiReference?.(hostName, {
                    naiReferenceImage: uploadedUrl,
                    naiReferenceEnabled: true,
                    naiReferenceStrength: 0.7,
                    naiReferenceInformationExtracted: 1
                });
                if (!updated) {
                    this.app?.phoneShell?.showNotification?.('蜜语', '没有找到这个主播', '⚠️');
                    return;
                }
                this.app?.phoneShell?.showNotification?.('蜜语', `${hostName} 的角色参考图已保存`, '✅');
                this.render();
            } catch (err) {
                this.app?.phoneShell?.showNotification?.('参考图保存失败', err?.message || String(err || '图片读取失败'), '❌');
            }
        });

        root.addEventListener('click', (e) => {
            const target = e.target?.closest?.('[data-action]');
            if (!target) return;
            const action = String(target.dataset.action || '').trim();
            const hostName = String(target.dataset.hostName || '').trim();

            if (action === 'toggle-follow-history') {
                e.preventDefault();
                e.stopPropagation();
                const card = target.closest('.honey-follow-item');
                if (!card) return;
                const nextExpanded = !card.classList.contains('is-expanded');
                card.classList.toggle('is-expanded', nextExpanded);
                return;
            }

            if (action === 'goto-follow-live') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const stableTopicKey = this._resolveFollowedHostTopicKey(hostName);
                const stableTopicTitle = `${hostName} 的直播间`;
                const cachedStableScene = this.app?.honeyData?.getTopicScene?.(stableTopicKey, stableTopicTitle);
                const hostHistory = this.app?.honeyData?.getHostHistory?.(hostName) || {};
                const dateKeys = Object.keys(hostHistory).sort((a, b) => String(b).localeCompare(String(a)));
                let latestScene = null;
                if (dateKeys.length > 0) latestScene = hostHistory[dateKeys[0]];

                const onlineTopic = this._findOnlineTopicByHostName(hostName);
                let topicToEnter = null;

                // 在线优先展示当前推荐里的主题；离线再回落历史最新场景
                if (onlineTopic && (cachedStableScene || latestScene)) {
                    topicToEnter = {
                        ...onlineTopic,
                        ...(cachedStableScene || latestScene),
                        title: onlineTopic.title || (cachedStableScene || latestScene).title,
                        viewers: onlineTopic.viewers || (cachedStableScene || latestScene).viewers,
                        playCount: onlineTopic.playCount || (cachedStableScene || latestScene).playCount,
                        fans: onlineTopic.fans || (cachedStableScene || latestScene).fans,
                        avatarUrl: onlineTopic.avatarUrl || (cachedStableScene || latestScene).avatarUrl,
                        naiPrompt: onlineTopic.naiPrompt || (cachedStableScene || latestScene).naiPrompt,
                        imageGenerationPrompt: onlineTopic.imageGenerationPrompt || (cachedStableScene || latestScene).imageGenerationPrompt,
                        naiImageUrl: onlineTopic.naiImageUrl || (cachedStableScene || latestScene).naiImageUrl,
                        generatedImageUrl: onlineTopic.generatedImageUrl || (cachedStableScene || latestScene).generatedImageUrl,
                        imageUrl: onlineTopic.imageUrl || (cachedStableScene || latestScene).imageUrl,
                        promptTurns: this.app?.honeyData?._normalizeContinuePromptTurns?.(
                            (cachedStableScene || latestScene).promptTurns,
                            this.app?.honeyData?.maxStoredPromptTurns,
                            { preserveLength: true }
                        ) || []
                    };
                } else {
                    topicToEnter = onlineTopic || cachedStableScene || latestScene;
                }

                if (!topicToEnter) {
                    topicToEnter = {
                        ...this._getFallbackTopic(),
                        title: `${hostName} 的直播间`,
                        host: hostName,
                        description: '主播暂未开播，点击下方刷新唤醒主播。'
                    };
                }

                topicToEnter = this._normalizeFollowedHostTopic(topicToEnter, hostName);
                const topicTitle = String(topicToEnter._topicTitle || topicToEnter.title || stableTopicTitle).trim();
                const topicKey = String(topicToEnter._topicKey || stableTopicKey || this._resolveTopicKey(topicToEnter, topicTitle)).trim();

                this.currentSceneData = { ...topicToEnter, _topicTitle: topicTitle, _topicKey: topicKey };
                this.enterLiveFromTopic(this.currentSceneData, { autoGenerateIfMissing: false, backTarget: 'follow' });
                return;
            }

            if (action === 'open-follow-video-modal') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const modal = root.querySelector('#honey-follow-video-modal');
                if (!modal) return;
                const titleEl = modal.querySelector('#honey-follow-video-modal-title');
                const listEl = modal.querySelector('#honey-follow-video-modal-list');
                if (!listEl) return;

                const uploadedVideos = this.app?.honeyData?.getCustomLiveVideos?.() || [];
                const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
                const followedHost = followedHosts.find(item => this._isSameHostName(item?.name, hostName));
                const boundVideoUrl = String(followedHost?.boundVideoUrl || '').trim();

                if (titleEl) {
                    titleEl.textContent = `${hostName} · 选择专属视频`;
                }

                listEl.innerHTML = uploadedVideos.length > 0
                    ? uploadedVideos.map((videoUrl) => {
                        const safeVideoUrl = String(videoUrl || '').trim();
                        const fileName = this._formatFollowVideoName(safeVideoUrl);
                        const isBound = !!boundVideoUrl && boundVideoUrl === safeVideoUrl;
                        return `
                            <button
                                class="honey-follow-video-item ${isBound ? 'is-bound' : ''}"
                                data-action="bind-follow-video"
                                data-host-name="${this._escapeHtml(hostName)}"
                                data-video-url="${this._escapeHtml(safeVideoUrl)}"
                            >
                                <span class="honey-follow-video-left"><i class="fa-regular fa-circle-play"></i> ${this._escapeHtml(fileName)}</span>
                                <span class="honey-follow-video-right">${isBound ? '已选' : '选择'}</span>
                            </button>
                        `;
                    }).join('')
                    : '<div class="honey-follow-video-empty">暂无上传视频，请先到设置页上传直播视频。</div>';

                modal.classList.add('is-open');
                modal.setAttribute('aria-hidden', 'false');
                return;
            }

            if (action === 'close-follow-video-modal') {
                e.preventDefault();
                e.stopPropagation();
                closeFollowVideoModal();
                return;
            }

            if (action === 'bind-follow-video') {
                e.preventDefault();
                e.stopPropagation();
                const videoUrl = String(target.dataset.videoUrl || '').trim();
                if (!hostName || !videoUrl) return;
                this.app?.honeyData?.bindHostVideo?.(hostName, videoUrl);
                closeFollowVideoModal();
                this.app.phoneShell.showNotification('蜜语', `已绑定 ${this._formatFollowVideoName(videoUrl)}`, '✅');
                this.render();
                return;
            }

            if (action === 'unbind-follow-video') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                this.app?.honeyData?.bindHostVideo?.(hostName, '');
                closeFollowVideoModal();
                this.app.phoneShell.showNotification('蜜语', '已取消专属视频绑定', '✅');
                this.render();
                return;
            }

            if (action === 'request-host-wechat-friend') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                target.disabled = true;
                target.classList.add('is-loading');
                const originalText = target.textContent;
                target.textContent = '申请中';
                (async () => {
                    try {
                        const decision = await this.app?.honeyData?.requestFollowedHostWechatFriendDecision?.(hostName, {
                            currentScene: this.currentSceneData
                        });
                        if (!decision?.accepted) {
                            this._showHostWechatFriendRejectDialog(hostName, decision?.message || '先不用加微信了。');
                            return;
                        }
                        const targetHostName = decision.hostName || hostName;
                        const linked = this.app?.honeyData?.ensureFollowedHostWechatChat?.(targetHostName, {
                            currentScene: this.currentSceneData,
                            contactName: decision.contactName || targetHostName,
                            decisionMessage: decision.message,
                            message: decision.message,
                            forceRecreateWechat: true
                        });
                        this.app.phoneShell.showNotification('已添加', `${decision.contactName || targetHostName} 已成为微信好友`, '✅');
                        this.render();
                        if (linked?.chat?.id) this._openWechatChatFromHoney(linked.chat.id);
                    } catch (err) {
                        console.error('主播加微信申请失败:', err);
                        this.app.phoneShell.showNotification('申请失败', err?.message || String(err || '请稍后重试'), '❌');
                    } finally {
                        if (target?.isConnected) {
                            target.disabled = false;
                            target.classList.remove('is-loading');
                            target.textContent = originalText || '加好友';
                        }
                    }
                })();
                return;
            }

            if (action === 'open-host-wechat-chat') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const linked = this.app?.honeyData?.ensureFollowedHostWechatChat?.(hostName);
                if (linked?.chat?.id) {
                    this._openWechatChatFromHoney(linked.chat.id);
                } else {
                    this.app.phoneShell.showNotification('打开失败', '还没找到这个主播对应的微信聊天', '⚠️');
                }
                return;
            }

            if (action === 'unfollow-host') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const result = this.app?.honeyData?.removeFollowedHost?.(hostName);
                const oldReferenceImage = result?.removedHost?.naiReferenceImage || '';
                window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldReferenceImage, { quiet: true });
                this.app.phoneShell.showNotification('蜜语', `已取消关注 ${hostName}`, '✅');
                this.render();
                return;
            }

            if (action === 'upload-follow-reference') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const card = target.closest('.honey-follow-item');
                const input = card?.querySelector?.('.honey-follow-reference-upload');
                input?.click?.();
                return;
            }

            if (action === 'remove-follow-reference') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;
                const currentHost = this.app?.honeyData?.getFollowedHostByName?.(hostName);
                const oldReferenceImage = currentHost?.naiReferenceImage || '';
                this.app?.honeyData?.updateFollowedHostNaiReference?.(hostName, {
                    naiReferenceImage: '',
                    naiReferenceEnabled: false
                });
                window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldReferenceImage, { quiet: true });
                this.app.phoneShell.showNotification('蜜语', '已删除角色参考图', '✅');
                this.render();
                return;
            }

            if (action === 'open-host-chat-history') {
                e.preventDefault();
                e.stopPropagation();
                if (!hostName) return;

                this._historyHostName = hostName;
                this.currentPage = 'history';
                this.render();
                return;
            }

            return;
        });

        root.addEventListener('input', (e) => {
            const slider = e.target?.closest?.('.honey-follow-reference-strength');
            if (!slider) return;
            const valueEl = slider.closest('.honey-follow-reference-card')?.querySelector?.('.honey-follow-reference-strength-value');
            const value = Math.max(0, Math.min(1, Number(slider.value) || 0));
            if (valueEl) valueEl.textContent = `${Math.round(value * 100)}%`;
        });

        root.addEventListener('change', (e) => {
            const enabledToggle = e.target?.closest?.('.honey-follow-reference-enabled');
            if (enabledToggle) {
                const hostName = String(enabledToggle.dataset.hostName || '').trim();
                if (!hostName) return;
                this.app?.honeyData?.updateFollowedHostNaiReference?.(hostName, {
                    naiReferenceEnabled: !!enabledToggle.checked
                });
                this.render();
                return;
            }

            const slider = e.target?.closest?.('.honey-follow-reference-strength');
            if (slider) {
                const hostName = String(slider.dataset.hostName || '').trim();
                if (!hostName) return;
                const value = Math.max(0, Math.min(1, Number(slider.value) || 0));
                this.app?.honeyData?.updateFollowedHostNaiReference?.(hostName, {
                    naiReferenceStrength: value
                });
                return;
            }
        });
    }

    async renderHoneyWorldbookList() {
        const root = document.querySelector('.phone-view-current .honey-page-settings') || document.querySelector('.honey-page-settings');
        const container = root?.querySelector?.('#phone-honey-worldbook-list');
        const manager = window.VirtualPhone?.worldbookManager;
        if (!container || !manager) return;

        try {
            const sources = await manager.listAvailableWorldbooks({ includeEntries: true, force: true });
            const selection = manager.getSelectionState('honey');
            if (sources.length === 0) {
                container.innerHTML = '<div class="honey-settings-desc" style="padding-top: 8px;">未读取到酒馆世界书列表。</div>';
                return;
            }

            const isSelectedSource = (source) => selection.initialized && manager.matchesSelection?.(source, selection.ids);
            const displaySources = [...sources].sort((a, b) => {
                const aSelected = isSelectedSource(a) ? 1 : 0;
                const bSelected = isSelectedSource(b) ? 1 : 0;
                return bSelected - aSelected;
            });

            container.innerHTML = displaySources.map(source => {
                const checked = (selection.initialized && manager.matchesSelection?.(source, selection.ids)) ? 'checked' : '';
                const activeCount = Number(source.entries?.length || 0);
                const totalCount = Number(source.totalEntries ?? activeCount);
                const disabledText = activeCount ? '' : (totalCount > 0 ? '（无开启条目）' : '（读取失败或为空）');
                const countText = totalCount > activeCount ? `${activeCount}/${totalCount} 条可注入` : `${activeCount} 条`;
                return `
                    <label class="phone-honey-worldbook-item">
                        <input type="checkbox" class="phone-honey-worldbook-choice" value="${this._escapeHtml(source.id)}" ${checked} style="margin-top: 2px;">
                        <span class="phone-honey-worldbook-text">
                            <span class="phone-honey-worldbook-name">${this._escapeHtml(source.name)}${this._escapeHtml(disabledText)}</span>
                            <span class="phone-honey-worldbook-meta">${this._escapeHtml(source.sourceLabel || '世界书')} · ${this._escapeHtml(countText)}</span>
                        </span>
                    </label>
                `;
            }).join('');

            container.querySelectorAll('.phone-honey-worldbook-choice').forEach(input => {
                input.addEventListener('change', async () => {
                    const ids = Array.from(container.querySelectorAll('.phone-honey-worldbook-choice:checked')).map(item => item.value);
                    await manager.setSelection('honey', ids);
                    this.renderHoneyWorldbookList();
                });
            });
        } catch (error) {
            console.warn('[Honey] 世界书列表渲染失败:', error);
            container.innerHTML = '<div class="honey-settings-desc" style="padding-top: 8px; color: #d93025;">世界书读取失败，请稍后重试。</div>';
        }
    }

    bindSettingsEvents() {
        const promptManager = this._getPromptManager();
        const root = document.querySelector('.phone-view-current .honey-page-settings') || document.querySelector('.honey-page-settings');
        if (!root) return;
        if (root.dataset.honeySettingsBound === '1') return;
        root.dataset.honeySettingsBound = '1';
        this._bindPromptFoldToggles(root);
        this._renderCustomVideoList();

        root.querySelector('#honey-back-from-settings')?.addEventListener('click', () => {
            this.currentPage = this._settingsReturnPage || 'recommend';
            this.render();
        });

        const refreshEconomyPanel = () => {
            const coinBalance = this.app?.honeyData?.getHoneyCoinBalance?.() || 0;
            const walletInfo = this.app?.honeyData?.getWechatWalletBalanceForRecharge?.() || { available: false, initialized: false, balance: 0 };
            const walletText = walletInfo.available
                ? (walletInfo.initialized ? `¥${this._formatMoneyDisplay(walletInfo.balance)}` : '未初始化')
                : '未加载微信';

            const coinText = this._formatCoinDisplay(coinBalance);
            const balanceEl = root.querySelector('#honey-coin-balance');
            const walletEl = root.querySelector('#honey-recharge-wallet');
            const rechargeCoinsEl = root.querySelector('#honey-recharge-coins');
            if (balanceEl) balanceEl.textContent = coinText;
            if (walletEl) walletEl.textContent = walletText;
            if (rechargeCoinsEl) rechargeCoinsEl.textContent = coinText;
        };

        const rechargeModal = root.querySelector('#honey-recharge-modal');
        const rechargeInput = root.querySelector('#honey-recharge-yuan');
        const rechargePreview = root.querySelector('#honey-recharge-preview');

        const updateRechargePreview = () => {
            const parsed = Number.parseFloat(rechargeInput?.value || '0');
            const coinPreview = Number.isFinite(parsed) && parsed > 0
                ? Math.max(1, Math.round(parsed * 10))
                : 0;
            if (rechargePreview) rechargePreview.textContent = this._formatCoinDisplay(coinPreview);
        };

        const closeRechargeModal = () => {
            rechargeModal?.classList.remove('is-open');
        };

        const openRechargeModal = () => {
            refreshEconomyPanel();
            updateRechargePreview();
            rechargeModal?.classList.add('is-open');
        };

        root.querySelector('#honey-save-nickname')?.addEventListener('click', () => {
            const input = root.querySelector('#honey-user-nickname');
            const saved = this.app?.honeyData?.saveHoneyUserNickname?.(input?.value || '') || '';
            if (input) input.value = saved;
            this.app.phoneShell.showNotification('已保存', '观众昵称已更新', '✅');
        });

        root.querySelector('#honey-user-nickname')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            root.querySelector('#honey-save-nickname')?.click();
        });

        root.querySelector('#honey-open-recharge')?.addEventListener('click', () => {
            const walletInfo = this.app?.honeyData?.getWechatWalletBalanceForRecharge?.() || { available: false, initialized: false, balance: 0 };
            if (!walletInfo.available) {
                this.app.phoneShell.showNotification('充值失败', '微信未加载，无法读取钱包余额', '⚠️');
                return;
            }
            if (!walletInfo.initialized) {
                this.app.phoneShell.showNotification('充值失败', '请先到微信服务页初始化零钱余额', '⚠️');
                return;
            }
            openRechargeModal();
        });

        root.querySelector('#honey-open-withdraw')?.addEventListener('click', () => {
            const coinBalance = this.app?.honeyData?.getHoneyCoinBalance?.() || 0;
            if (coinBalance <= 0) {
                this.app.phoneShell.showNotification('提现失败', '当前蜜语金币余额为 0', 'ℹ️');
                return;
            }

            const inputText = window.prompt(`输入要提现的金币数量（当前 ${this._formatCoinDisplay(coinBalance)} 金币，10 金币 = 1 元）`, String(coinBalance));
            if (inputText === null) return;

            const withdrawCoins = Math.max(0, Math.floor(Number.parseFloat(String(inputText).trim()) || 0));
            const result = this.app?.honeyData?.withdrawHoneyCoinsToWechat?.(withdrawCoins);
            if (!result?.success) {
                if (result?.reason === 'coin_insufficient') {
                    this.app.phoneShell.showNotification('提现失败', `金币不足，当前仅 ${this._formatCoinDisplay(result.balanceBefore || 0)} 金币`, '⚠️');
                    return;
                }
                if (result?.reason === 'wallet_not_initialized') {
                    this.app.phoneShell.showNotification('提现失败', '请先到微信服务页初始化零钱余额', '⚠️');
                    return;
                }
                if (result?.reason === 'wechat_unavailable') {
                    this.app.phoneShell.showNotification('提现失败', '微信未加载，无法提现吗', '⚠️');
                    return;
                }
                this.app.phoneShell.showNotification('提现失败', '请输入有效的金币数量', '⚠️');
                return;
            }

            refreshEconomyPanel();
            this.app.phoneShell.showNotification(
                '提现成功',
                `已转入微信 ¥${this._formatMoneyDisplay(result.amountYuan || 0)}，剩余 ${this._formatCoinDisplay(result.balanceAfter || 0)} 金币`,
                '✅'
            );
        });

        root.querySelector('#honey-cancel-recharge')?.addEventListener('click', closeRechargeModal);
        root.querySelector('[data-action="close-recharge"]')?.addEventListener('click', closeRechargeModal);
        rechargeInput?.addEventListener('input', updateRechargePreview);

        root.querySelector('#phone-honey-use-worldbook')?.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await window.VirtualPhone?.worldbookManager?.setEnabled?.('honey', enabled);
            if (enabled) this.renderHoneyWorldbookList();
            this.app.phoneShell.showNotification(
                enabled ? '已开启' : '已关闭',
                `蜜语生成${enabled ? '会' : '不会'}注入勾选的世界书`,
                enabled ? '✅' : 'ℹ️'
            );
        });

        root.querySelector('#phone-image-honey-auto-generate')?.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await this.app?.storage?.set?.('phone-image-honey-auto-generate', enabled);
            this.app.phoneShell.showNotification(
                enabled ? '已开启' : '已关闭',
                `蜜语直播${enabled ? '会' : '不会'}在新剧情后自动生图`,
                enabled ? '✅' : 'ℹ️'
            );
        });

        root.querySelector('#honey-confirm-recharge')?.addEventListener('click', () => {
            const yuan = Number.parseFloat(rechargeInput?.value || '0');
            const result = this.app?.honeyData?.rechargeHoneyCoinsFromWechat?.(yuan);
            if (!result?.success) {
                if (result?.reason === 'wallet_insufficient') {
                    this.app.phoneShell.showNotification(
                        '充值失败',
                        `微信余额不足（当前¥${this._formatMoneyDisplay(result.walletBalance || 0)}）`,
                        '❌'
                    );
                    return;
                }
                if (result?.reason === 'wallet_not_initialized') {
                    this.app.phoneShell.showNotification('充值失败', '请先初始化微信零钱余额', '⚠️');
                    return;
                }
                if (result?.reason === 'wechat_unavailable') {
                    this.app.phoneShell.showNotification('充值失败', '微信未加载，无法充值', '⚠️');
                    return;
                }
                this.app.phoneShell.showNotification('充值失败', '请输入有效充值金额', '⚠️');
                return;
            }

            rechargeInput.value = '';
            updateRechargePreview();
            refreshEconomyPanel();
            this.app.phoneShell.showNotification(
                '充值成功',
                `+${this._formatCoinDisplay(result.coinGain)}金币，余额${this._formatCoinDisplay(result.balanceAfter)}`,
                '✅'
            );
            closeRechargeModal();
        });

        root.querySelector('#honey-save-prompt')?.addEventListener('click', () => {
            const overrideTextarea = root.querySelector('#honey-override-prompt-editor');
            const textarea = root.querySelector('#honey-prompt-editor');
            const userLiveTextarea = root.querySelector('#honey-user-live-prompt-editor');
            const overrideContent = overrideTextarea?.value ?? '';
            const content = textarea?.value ?? '';
            const userLiveContent = userLiveTextarea?.value ?? '';
            promptManager?.updateActivePromptUserPreset?.('honey', 'override', overrideContent) ?? promptManager?.updatePrompt?.('honey', 'override', overrideContent);
            promptManager?.updateActivePromptUserPreset?.('honey', 'live', content) ?? promptManager?.updatePrompt?.('honey', 'live', content);
            promptManager?.updateActivePromptUserPreset?.('honey', 'userLive', userLiveContent) ?? promptManager?.updatePrompt?.('honey', 'userLive', userLiveContent);
            this.app.phoneShell.showNotification('保存成功', '蜜语提示词已更新', '✅');
        });

        root.querySelector('#honey-reset-prompt')?.addEventListener('click', () => {
            const defaultOverrideContent = promptManager?.resetPromptToDefault?.('honey', 'override')
                ?? promptManager?.getDefaultPrompts?.()?.honey?.override?.content
                ?? '';
            const defaultContent = promptManager?.resetPromptToDefault?.('honey', 'live')
                ?? promptManager?.getDefaultPrompts?.()?.honey?.live?.content
                ?? '';
            const defaultUserLiveContent = promptManager?.resetPromptToDefault?.('honey', 'userLive')
                ?? promptManager?.getDefaultPrompts?.()?.honey?.userLive?.content
                ?? '';
            const overrideTextarea = root.querySelector('#honey-override-prompt-editor');
            const textarea = root.querySelector('#honey-prompt-editor');
            const userLiveTextarea = root.querySelector('#honey-user-live-prompt-editor');
            if (overrideTextarea) overrideTextarea.value = defaultOverrideContent;
            if (textarea) textarea.value = defaultContent;
            if (userLiveTextarea) userLiveTextarea.value = defaultUserLiveContent;
            this.app.phoneShell.showNotification('已恢复', '已恢复默认提示词', '🔄');
        });

        promptManager?.bindPromptPresetControls?.(root, 'honey', 'override', '#honey-override-prompt-editor', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        promptManager?.bindPromptPresetControls?.(root, 'honey', 'live', '#honey-prompt-editor', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });
        promptManager?.bindPromptPresetControls?.(root, 'honey', 'userLive', '#honey-user-live-prompt-editor', {
            notify: (title, message, icon) => this.app.phoneShell.showNotification(title, message, icon)
        });

        const videoUploadInput = root.querySelector('#honey-bg-video-upload');
        if (videoUploadInput) {
            videoUploadInput.addEventListener('change', async (e) => {
                const file = e?.target?.files?.[0];
                if (!file) return;
                e.target.value = '';

                const mime = String(file.type || '').toLowerCase();
                const ext = mime.includes('webm') ? 'webm' : (mime.includes('mp4') ? 'mp4' : '');
                if (!ext) {
                    this.app.phoneShell.showNotification('提示', '请选择 MP4 或 WebM 视频', '⚠️');
                    return;
                }
                if (file.size > 20 * 1024 * 1024) {
                    this.app.phoneShell.showNotification('提示', '视频大小不能超过 20MB', '⚠️');
                    return;
                }

                this.app.phoneShell.showNotification('处理中', '正在上传动态背景...', '⏳');

                try {
                    const finalUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(file, 'honey_bg');
                    if (!finalUrl) throw new Error('图片上传管理器未初始化');

                    this.app.honeyData?.saveRecommendBgVideo?.(finalUrl);
                    this.app.phoneShell.showNotification('成功', '动态背景已更新', '✅');
                    this.render();
                } catch (err) {
                    console.error('蜜语背景视频上传失败:', err);
                    const detail = String(err?.message || '').trim();
                    const message = detail ? `视频上传失败：${detail}` : '视频上传失败，请稍后重试';
                    this.app.phoneShell.showNotification('错误', message, '❌');
                }
            });
        }

        root.querySelector('#honey-delete-bg-video')?.addEventListener('click', () => {
            this.app.honeyData?.saveRecommendBgVideo?.(null);
            this.app.phoneShell.showNotification('已恢复', '动态背景已清除', '✅');
            this.render();
        });

        // 自定义视频池上传
        const liveVideoUploadInput = root.querySelector('#honey-live-video-upload');
        if (liveVideoUploadInput) {
            liveVideoUploadInput.addEventListener('change', async (e) => {
                const file = e?.target?.files?.[0];
                if (!file) return;
                e.target.value = '';

                const mime = String(file.type || '').toLowerCase();
                const ext = mime.includes('webm') ? 'webm' : (mime.includes('mp4') ? 'mp4' : '');
                if (!ext) {
                    this.app.phoneShell.showNotification('提示', '请选择 MP4 或 WebM 视频', '⚠️');
                    return;
                }
                if (file.size > 20 * 1024 * 1024) {
                    this.app.phoneShell.showNotification('提示', '视频大小不能超过 20MB', '⚠️');
                    return;
                }

                const defaultName = `honey_live_${Date.now()}`;
                let customName = window.prompt('请为该视频命名\n(建议使用纯英文+数字，避免特殊字符导致无法加载)：', defaultName);
                if (customName === null) return;

                customName = customName.replace(/[^a-zA-Z0-9_-]/g, '').trim();
                if (!customName) customName = defaultName;

                this.app.phoneShell.showNotification('处理中', '正在上传并添加到视频池...', '⏳');

                try {
                    const finalUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(file, `honey_live_${customName}`);
                    if (!finalUrl) throw new Error('图片上传管理器未初始化');
                    this.app.honeyData?.addCustomLiveVideo?.(finalUrl);
                    this.app.phoneShell.showNotification('成功', '视频已添加到随机池', '✅');
                    this._renderCustomVideoList();
                } catch (err) {
                    console.error('视频上传失败:', err);
                    const detail = String(err?.message || '').trim();
                    const message = detail ? `视频上传失败：${detail}` : '视频上传失败，请稍后重试';
                    this.app.phoneShell.showNotification('错误', message, '❌');
                }
            });
        }

        root.querySelector('#honey-clear-data')?.addEventListener('click', async () => {
            const ok = confirm('确定一键清理蜜语的所有生成内容？\n\n将删除：\n1) 推荐与直播缓存\n2) 关注列表与关注历史备份\n3) 蜜语好友申请\n4) 当前会话中的 <Honey> 标签内容\n5) 蜜语生成并保存到 /backgrounds/ 的直播图片\n\n此操作不可恢复。');
            if (!ok) return;

            try {
                const imageCleanup = await this.app?.honeyData?.cleanupGeneratedImageFiles?.([
                    this.currentSceneData,
                    this.selectedTopic,
                    this.recommendTopics
                ]);
                this.app?.honeyData?.clearGeneratedSessionData?.();
                this.app?.honeyData?.saveRecommendTopics?.([]);
                this.app?.honeyData?.clearCache?.();
                await this.app?.honeyData?.clearHoneyChatHistory?.();

                this.recommendTopics = this._getDefaultTopics();
                this.currentSceneData = null;
                this.selectedTopic = null;
                this.isScenePanelOpen = false;
                this._isSceneTagHistoryOpen = false;

                this.currentPage = 'settings';
                this.render();
                const attempted = Number(imageCleanup?.attempted || 0);
                const failed = Number(imageCleanup?.failed || 0);
                const imageText = attempted > 0
                    ? `，生成图${attempted - failed}/${attempted}张已清理`
                    : '';
                this.app.phoneShell.showNotification('已清理', `蜜语内容已清空${imageText}`, '🧹');
            } catch (err) {
                console.error('蜜语一键清理失败:', err);
                this.app.phoneShell.showNotification('错误', err.message || String(err), '❌');
            }
        });

        refreshEconomyPanel();
    }

    _bindPromptFoldToggles(root) {
        if (!root) return;
        root.querySelectorAll('.phone-prompt-fold').forEach(fold => {
            if (fold.dataset.foldInited !== '1') {
                fold.dataset.foldInited = '1';
                fold.classList.toggle('is-open', String(fold.dataset.defaultOpen || '').toLowerCase() === 'true');
            }
        });
        root.querySelectorAll('.phone-prompt-fold-header').forEach(header => {
            if (header.dataset.foldBound === '1') return;
            header.dataset.foldBound = '1';
            header.addEventListener('click', () => {
                const fold = header.closest('.phone-prompt-fold');
                if (!fold) return;
                fold.classList.toggle('is-open');
            });
        });
    }

    openSettings() {
        if (this.currentPage !== 'settings') {
            this._settingsReturnPage = this.currentPage || 'recommend';
        }
        this.currentPage = 'settings';
        this.render();
    }

    enterLiveFromTopic(topic, options = {}) {
        const autoGenerateIfMissing = options?.autoGenerateIfMissing === true;
        const resetSession = options?.resetSession === true;
        const resolvedTopic = topic || this._getFallbackTopic();
        const topicTitle = String(resolvedTopic.title || '直播间').trim();
        const topicKey = this._resolveTopicKey(resolvedTopic, topicTitle);
        this._liveBackTarget = this._resolveLiveBackTarget(topicKey, options);
        if (this._liveBackTarget === 'recommend') {
            this._liveEntrySource = 'recommend';
        } else if (this._liveBackTarget === 'follow') {
            this._liveEntrySource = 'follow';
        } else if (this._liveBackTarget === 'mine') {
            this._liveEntrySource = 'mine';
        } else {
            this._liveEntrySource = 'direct';
        }
        this.selectedTopic = {
            ...this._getFallbackTopic(),
            ...resolvedTopic,
            title: topicTitle,
            _topicKey: topicKey
        };
        this._dismissedLiveCollabRequestFingerprint = '';
        this.currentPage = 'live';
        this.app.honeyData?.saveSelectedTopicTitle?.(topicTitle);
        this.app.honeyData?.saveSelectedTopicKey?.(topicKey);

        if (resetSession) {
            this.app.honeyData?.clearTopicScene?.(topicKey || topicTitle, {
                clearLastSceneIfMatch: true,
                fallbackTitle: topicTitle,
                topicKey
            });
        }

        const cachedScene = resetSession
            ? null
            : this.app.honeyData?.getTopicScene?.(topicKey || topicTitle, topicTitle);
        if (cachedScene) {
            this.currentSceneData = { ...cachedScene, _topicTitle: topicTitle, _topicKey: topicKey };
            if (options?.forceVisibilityChoice === true) {
                this._liveVisibilityModalOpen = true;
            }
            this._persistCurrentScene();
            this.render();
            return;
        }

        this.currentSceneData = this._buildBaseScene(this.selectedTopic, topicTitle, topicKey);
        this.currentSceneData.title = topicTitle;
        this.currentSceneData.description = autoGenerateIfMissing
            ? '正在根据主题生成直播内容...'
            : (topicKey === 'topic_user_live' ? this._getUserLiveIdleHintText() : this._getRecommendRefreshHintText());
        this.currentSceneData.comments = [];
        this.currentSceneData.lastUserComment = '';
        this.currentSceneData.userChats = [];
        this.currentSceneData.promptTurns = [];
        this.currentSceneData.gifts = [];
        this.currentSceneData.audienceGiftTotals = {};
        this.currentSceneData.leaderboard = [];
        this.currentSceneData.userGiftRank = null;
        this.currentSceneData.isUserLive = topicKey === 'topic_user_live';
        const visibility = String(options?.visibility || this.selectedTopic?.visibility || '').trim() === 'private' ? 'private' : 'public';
        this.currentSceneData.visibility = visibility;
        this.currentSceneData.isPrivateLive = visibility === 'private';
        if (options?.forceVisibilityChoice === true) {
            this._liveVisibilityModalOpen = true;
        }
        this.currentPage = 'live';
        this._persistCurrentScene();
        this.render();

        if (!autoGenerateIfMissing) return;

        this._generateCurrentTopicScene({
            resetSession,
            notify: false,
            forceTopicTitle: topicTitle,
            forceTopicKey: topicKey
        }).then(() => {
            if (this._isActiveLiveTopic(topicKey, topicTitle)) this.render();
        }).catch(err => {
            console.error('蜜语主题生成失败:', err);
            if (this._isActiveLiveTopic(topicKey, topicTitle) && this.currentSceneData) {
                this.currentSceneData.description = `获取失败：${err.message || err}`;
                this._persistCurrentScene();
            }
            if (this._isActiveLiveTopic(topicKey, topicTitle)) this.render();
        });
    }

    openFollowedHostLive(hostName, options = {}) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return false;
        const followedHost = this.app?.honeyData?.getFollowedHostByName?.(safeHostName)
            || this.app?.honeyData?.ensureFollowedHostFromWechat?.(safeHostName, options);
        if (!followedHost) return false;
        const topicTitle = String(followedHost.liveTitle || `${followedHost.name} 的直播间`).trim();
        const inviteSource = String(options?.inviteSource || '').trim();
        const inviteIntro = inviteSource === 'friend_invite'
            ? '你接受了微信好友发起的蜜语邀约。'
            : (inviteSource === 'user_request'
                ? '微信好友接受了你发起的蜜语邀约。'
                : String(options?.intro || '').trim());
        const resetSession = options?.resetSession === true;
        const stableTopicKey = this._resolveFollowedHostTopicKey(followedHost.name || safeHostName);
        const cachedScene = resetSession ? null : this.app?.honeyData?.getTopicScene?.(stableTopicKey, topicTitle);
        const topic = {
            ...this._getFallbackTopic(),
            ...(cachedScene && typeof cachedScene === 'object' ? cachedScene : {}),
            title: topicTitle,
            host: followedHost.name || safeHostName,
            avatarUrl: followedHost.avatarUrl || '',
            intro: inviteIntro || cachedScene?.intro || followedHost.intro || '微信好友发来的蜜语直播邀约。',
            fans: followedHost.fans || '',
            favorability: followedHost.favorability ?? 0,
            description: cachedScene?.description || '主播正在等待你进入直播间。',
            _topicTitle: topicTitle,
            _topicKey: stableTopicKey
        };
        this.currentSceneData = {
            ...topic,
            comments: Array.isArray(topic.comments) ? topic.comments : [],
            userChats: Array.isArray(topic.userChats) ? topic.userChats : [],
            promptTurns: Array.isArray(topic.promptTurns) ? topic.promptTurns : [],
            gifts: Array.isArray(topic.gifts) ? topic.gifts : [],
            leaderboard: Array.isArray(topic.leaderboard) ? topic.leaderboard : [],
            audienceGiftTotals: topic.audienceGiftTotals && typeof topic.audienceGiftTotals === 'object' ? topic.audienceGiftTotals : {},
            userGiftRank: topic.userGiftRank && typeof topic.userGiftRank === 'object' ? topic.userGiftRank : null
        };
        this.enterLiveFromTopic(this.currentSceneData, {
            autoGenerateIfMissing: options?.autoGenerateIfMissing === true,
            resetSession,
            backTarget: 'follow',
            forceVisibilityChoice: true
        });
        return true;
    }

    handleBackAction() {
        if (this.currentPage === 'settings') {
            this.currentPage = this._settingsReturnPage || 'recommend';
            this.render();
            return true;
        }

        if (this.currentPage === 'live') {
            this._silenceLiveSpeaker();
            this._navigateBackFromLive();
            return true;
        }

        if (this.currentPage !== 'recommend') {
            this.currentPage = 'recommend';
            this.render();
            return false;
        }

        this._silenceRecommendSpeaker();
        this.removePhoneChromeTheme();
        return false;
    }

    _silenceRecommendSpeaker() {
        const recommendRoots = document.querySelectorAll('.honey-page-recommend');
        recommendRoots.forEach(root => {
            const bgVideo = root.querySelector('#honey-bg-video-el');
            if (bgVideo) {
                bgVideo.muted = true;
            }

            const soundBtn = root.querySelector('#honey-bg-sound-btn');
            if (soundBtn) {
                soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            }
        });
    }

    _silenceLiveSpeaker() {
        const liveRoots = document.querySelectorAll('.honey-page-live');
        liveRoots.forEach(root => {
            const liveVideo = root.querySelector('#honey-live-video-el');
            if (liveVideo) {
                liveVideo.muted = true;
            }

            const soundBtn = root.querySelector('#honey-live-sound-btn');
            if (soundBtn) {
                soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            }
        });
        this._stopHoneyTtsPlayback();
    }

    _resolveHoneyTtsHostName(root = null) {
        const fromScene = String(this.currentSceneData?.host || this.selectedTopic?.host || '').trim();
        if (fromScene) return fromScene;

        const hostEl = root?.querySelector?.('#honey-ui-host')
            || document.querySelector('.phone-view-current .honey-page-live #honey-ui-host')
            || document.querySelector('.honey-page-live #honey-ui-host');
        return String(hostEl?.textContent || hostEl?.innerText || '').trim();
    }

    _normalizeHoneyTtsGender(gender = '') {
        const raw = String(gender || '').trim().toLowerCase();
        if (raw === 'male' || raw === 'm' || raw === '男') return 'male';
        if (raw === 'female' || raw === 'f' || raw === '女') return 'female';
        return '';
    }

    _getHoneyGlobalTtsVoiceConfig() {
        const storage = this.app?.storage;
        const provider = String(storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const scopedVoice = String(storage?.get?.(`phone-tts-${provider}-voice`) || '').trim();
        if (scopedVoice) return { provider, voice: scopedVoice, source: 'global' };
        if (provider !== 'volcengine') {
            return {
                provider,
                voice: String(storage?.get?.('phone-tts-voice') || '').trim(),
                source: 'global'
            };
        }
        return { provider, voice: '', source: 'global' };
    }

    _getHoneyGenderFallbackTtsVoice(gender = '') {
        const storage = this.app?.storage;
        const safeGender = this._normalizeHoneyTtsGender(gender);
        const globalConfig = this._getHoneyGlobalTtsVoiceConfig();
        if (!safeGender) return globalConfig;

        const provider = String(storage?.get?.(`phone-tts-fallback-${safeGender}-provider`) || globalConfig.provider || 'minimax_cn').trim() || 'minimax_cn';
        const voice = String(storage?.get?.(`phone-tts-fallback-${safeGender}-voice`) || '').trim();
        if (voice) {
            return { provider, voice, source: `fallback_${safeGender}` };
        }
        return globalConfig;
    }

    _resolveHoneyFallbackHostGender() {
        const profile = this.app?.honeyData?.getHoneyUserProfile?.() || {};
        const userGender = this._normalizeHoneyTtsGender(profile?.gender || 'female') || 'female';
        const scene = this.currentSceneData || this.selectedTopic || {};
        if (this._isUserLiveScene(scene)) return userGender;
        return userGender === 'male' ? 'female' : 'male';
    }

    _resolveHoneyTtsVoice(root = null) {
        const globalConfig = this._getHoneyGlobalTtsVoiceConfig();
        const hostName = this._resolveHoneyTtsHostName(root);

        if (hostName) {
            try {
                const wechatData = window.VirtualPhone?.wechatApp?.wechatData || this.app?.wechatData;
                const resolved = wechatData?.resolveTtsVoiceByName?.(hostName, { includeChats: true }) || null;
                const boundVoice = String(resolved?.voice || '').trim();
                if (boundVoice) {
                    return {
                        voice: boundVoice,
                        provider: String(resolved?.provider || globalConfig.provider).trim() || globalConfig.provider,
                        hostName,
                        contact: resolved.contact || null,
                        source: 'bound'
                    };
                }
            } catch (e) {
                console.warn('⚠️ 蜜语主播音色匹配失败:', e);
            }
        }

        const fallbackGender = this._resolveHoneyFallbackHostGender();
        const fallback = this._getHoneyGenderFallbackTtsVoice(fallbackGender);
        return {
            voice: fallback.voice,
            provider: fallback.provider,
            hostName,
            contact: null,
            fallbackGender,
            source: fallback.source || 'global'
        };
    }

    _getHoneyTtsConfig(root = null) {
        const storage = this.app?.storage;
        const ttsManager = window.VirtualPhone?.ttsManager;
        const resolvedVoice = this._resolveHoneyTtsVoice(root);
        const provider = String(resolvedVoice.provider || storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
        const defaults = {
            minimax_cn: { url: 'https://api.minimaxi.com/v1/t2a_v2', model: 'speech-02-hd', voice: 'female-shaonv' },
            minimax_intl: { url: 'https://api.minimax.io/v1/t2a_v2', model: 'speech-2.8-hd', voice: 'Chinese (Mandarin)_Warm_Girl' },
            openai: { url: 'https://api.openai.com/v1/audio/speech', model: 'tts-1', voice: 'alloy' },
            indextts: { url: 'http://127.0.0.1:7880/v1/audio/speech', model: 'index-tts2', voice: 'default.wav' },
            nimo: { url: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-tts', voice: 'mimo_default' },
            volcengine: { url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', model: 'seed-tts-2.0', voice: 'BV700_streaming' }
        };
        const providerDefault = defaults[provider] || defaults.minimax_cn;
        const resolvedConfig = ttsManager?._resolveConfig?.({ provider, voice: resolvedVoice.voice || undefined }) || null;
        const apiKey = String(resolvedConfig?.apiKey || storage?.get?.('phone-tts-key') || '').trim();
        const apiUrl = String(resolvedConfig?.apiUrl || storage?.get?.('phone-tts-url') || providerDefault.url || '').trim();
        const model = String(resolvedConfig?.model || storage?.get?.('phone-tts-model') || providerDefault.model || '').trim();
        const voice = String(resolvedVoice.voice || '').trim();
        return {
            provider,
            apiKey,
            apiUrl,
            model,
            voice,
            hostName: resolvedVoice.hostName || '',
            voiceSource: resolvedVoice.source || 'global',
            ready: (provider === 'indextts' || !!apiKey) && !!apiUrl && !!voice
        };
    }

    _setHoneyTtsButtonState(btn, state = 'idle') {
        if (!btn) return;
        const safeState = state === 'loading' || state === 'playing' ? state : 'idle';
        btn.classList.toggle('is-loading', safeState === 'loading');
        btn.classList.toggle('is-playing', safeState === 'playing');
        if (safeState === 'loading') {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            return;
        }
        btn.disabled = false;
        btn.innerHTML = safeState === 'playing'
            ? '<i class="fa-solid fa-stop"></i>'
            : '<i class="fa-solid fa-volume-high"></i>';
    }

    _resolveCurrentSceneSpeechText(root = null) {
        const fromScene = String(this.currentSceneData?.description || '').trim();
        if (fromScene) return fromScene;
        const sceneEl = root?.querySelector?.('#honey-ui-scene-modal')
            || root?.querySelector?.('#honey-ui-scene')
            || document.querySelector('.phone-view-current .honey-page-live #honey-ui-scene-modal')
            || document.querySelector('.honey-page-live #honey-ui-scene-modal')
            || document.querySelector('.phone-view-current .honey-page-live #honey-ui-scene')
            || document.querySelector('.honey-page-live #honey-ui-scene');
        return String(sceneEl?.textContent || '').trim();
    }

    _normalizeHoneySpeechText(text = '') {
        return String(text || '')
            .replace(/<br\s*\/?>/ig, '\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    _extractHoneyQuotedSpeech(text = '') {
        const normalized = this._normalizeHoneySpeechText(text);
        if (!normalized) return '';
        const quoted = Array.from(normalized.matchAll(/“([^”]+)”/g))
            .map(match => String(match?.[1] || '').trim())
            .filter(Boolean);
        if (quoted.length > 0) return quoted.join('，');
        const fallbackQuoted = Array.from(normalized.matchAll(/"([^"]+)"/g))
            .map(match => String(match?.[1] || '').trim())
            .filter(Boolean);
        return fallbackQuoted.join('，');
    }

    _buildHoneyTtsCacheKey(config = {}, text = '') {
        const seed = [
            String(config.provider || ''),
            String(config.apiUrl || ''),
            String(config.model || ''),
            String(config.voice || ''),
            String(text || '')
        ].join('|');
        return `honey_tts_${this._simpleHash(seed)}_${String(text || '').length}`;
    }

    _touchHoneyTtsCacheKey(cacheKey = '') {
        if (!cacheKey) return;
        this._honeyTtsCacheOrder = this._honeyTtsCacheOrder.filter(key => key !== cacheKey);
        this._honeyTtsCacheOrder.push(cacheKey);
    }

    _storeHoneyTtsCache(cacheKey = '', blobUrl = '') {
        if (!cacheKey || !blobUrl) return;
        const existed = this._honeyTtsCache.get(cacheKey);
        if (existed && existed !== blobUrl) {
            try { URL.revokeObjectURL(existed); } catch (e) { /* ignore */ }
        }
        this._honeyTtsCache.set(cacheKey, blobUrl);
        this._touchHoneyTtsCacheKey(cacheKey);
        while (this._honeyTtsCacheOrder.length > this._honeyTtsMaxCacheSize) {
            const oldKey = this._honeyTtsCacheOrder.shift();
            if (!oldKey) continue;
            const oldUrl = this._honeyTtsCache.get(oldKey);
            this._honeyTtsCache.delete(oldKey);
            if (oldUrl) {
                try { URL.revokeObjectURL(oldUrl); } catch (e) { /* ignore */ }
            }
        }
    }

    _clearHoneyTtsCache() {
        this._honeyTtsCache.forEach((blobUrl) => {
            if (!blobUrl) return;
            try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
        });
        this._honeyTtsCache.clear();
        this._honeyTtsCacheOrder = [];
    }

    _cleanupHoneyTtsActiveBlob({ forceRevoke = false } = {}) {
        const activeUrl = this._honeyTtsActiveBlobUrl;
        if (!activeUrl) return;
        if (forceRevoke && this._honeyTtsActiveBlobCached) {
            const matchedKeys = [];
            this._honeyTtsCache.forEach((url, key) => {
                if (url === activeUrl) matchedKeys.push(key);
            });
            matchedKeys.forEach((key) => {
                this._honeyTtsCache.delete(key);
                this._honeyTtsCacheOrder = this._honeyTtsCacheOrder.filter(item => item !== key);
            });
        }
        if (forceRevoke || !this._honeyTtsActiveBlobCached) {
            try { URL.revokeObjectURL(activeUrl); } catch (e) { /* ignore */ }
        }
        this._honeyTtsActiveBlobUrl = '';
        this._honeyTtsActiveBlobCached = false;
    }

    _stopHoneyTtsPlayback() {
        const audio = this._honeyTtsAudio;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.onended = null;
            audio.onerror = null;
        }
        this._cleanupHoneyTtsActiveBlob();
        const btn = this._honeyTtsPlayingBtn;
        if (btn) {
            this._setHoneyTtsButtonState(btn, 'idle');
        }
        this._honeyTtsPlayingBtn = null;
    }

    async _requestHoneyTtsBlobUrl(text = '', config = {}) {
        const { apiKey, apiUrl, voice } = config;
        const ttsManager = window.VirtualPhone?.ttsManager;
        if (!ttsManager) {
            throw new Error('TTS 管理器未初始化');
        }
        if ((!apiKey && config.provider !== 'indextts') || !apiUrl) {
            throw new Error('请先配置 TTS 的 API URL 和 API Key / Access Token');
        }
        return ttsManager.requestTTS(text, { provider: config.provider || undefined, voice: voice || undefined });
    }

    async _playHoneySceneTts(text = '', btn = null) {
        const cleanText = this._normalizeHoneySpeechText(text);
        if (!cleanText) throw new Error('没有可播放的文本内容');

        const root = btn?.closest?.('.honey-page-live') || null;
        const config = this._getHoneyTtsConfig(root);
        if (!config.ready) {
            if (!config.voice) throw new Error('请先在设置中配置全局兜底音色，或给该主播绑定专属音色');
            throw new Error('请先在设置中配置 TTS 接口信息');
        }

        this._stopHoneyTtsPlayback();
        const useCache = this.app?.storage?.get?.('phone-honey-tts-cache-enabled') !== false;
        if (!useCache) {
            this._clearHoneyTtsCache();
        }
        this._honeyTtsPlayingBtn = btn;
        this._setHoneyTtsButtonState(btn, 'loading');

        const cacheKey = this._buildHoneyTtsCacheKey(config, cleanText);
        let blobUrl = '';
        let fromCache = false;
        if (useCache && cacheKey) {
            const cachedUrl = this._honeyTtsCache.get(cacheKey);
            if (cachedUrl) {
                blobUrl = cachedUrl;
                fromCache = true;
                this._touchHoneyTtsCacheKey(cacheKey);
            }
        }

        if (!blobUrl) {
            blobUrl = await this._requestHoneyTtsBlobUrl(cleanText, config);
            if (useCache && cacheKey && blobUrl) {
                this._storeHoneyTtsCache(cacheKey, blobUrl);
                fromCache = true;
            }
        }

        const audio = this._honeyTtsAudio || new Audio();
        this._honeyTtsAudio = audio;
        this._honeyTtsActiveBlobUrl = blobUrl;
        this._honeyTtsActiveBlobCached = fromCache;
        this._setHoneyTtsButtonState(btn, 'playing');

        await new Promise((resolve, reject) => {
            const cleanup = ({ revokeCurrent = false } = {}) => {
                audio.onended = null;
                audio.onerror = null;
                if (this._honeyTtsPlayingBtn === btn) {
                    this._honeyTtsPlayingBtn = null;
                }
                this._setHoneyTtsButtonState(btn, 'idle');
                this._cleanupHoneyTtsActiveBlob({ forceRevoke: revokeCurrent });
            };

            audio.onended = () => {
                cleanup({ revokeCurrent: false });
                resolve();
            };
            audio.onerror = () => {
                cleanup({ revokeCurrent: true });
                reject(new Error('音频播放失败'));
            };

            audio.src = blobUrl;
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    cleanup({ revokeCurrent: true });
                    reject(err || new Error('播放失败'));
                });
            }
        });
    }

    _ensureRecommendVideoAutoplay(bgVideo) {
        if (!bgVideo) return;
        const playPromise = bgVideo.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn('视频自动播放被浏览器拦截，正尝试重试:', error);
            });
        }
    }

    _setFollowButtonState(btn, isFollowed) {
        if (!btn) return;
        btn.classList.toggle('is-followed', !!isFollowed);
        btn.innerHTML = isFollowed ? '已关注' : '关注';
    }

    _showHoneyImageErrorModal(message = '生成失败', { title = '生图失败' } = {}) {
        const host = document.querySelector('.phone-view-current .honey-app') ||
            document.querySelector('.phone-view-current') ||
            document.querySelector('.phone-body-panel') ||
            document.body;
        if (!host) return;
        host.querySelector('#honey-image-error-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'honey-image-error-modal';
        overlay.style.cssText = 'position:absolute; inset:0; z-index:2600; background:rgba(0,0,0,0.48); display:flex; align-items:center; justify-content:center; padding:18px; box-sizing:border-box;';
        overlay.innerHTML = `
            <div role="dialog" aria-modal="true" style="width:100%; max-width:310px; max-height:76%; background:#fff; color:#171717; border-radius:14px; box-shadow:0 14px 34px rgba(0,0,0,0.28); overflow:hidden; display:flex; flex-direction:column;">
                <div style="padding:14px 16px 8px; font-size:16px; font-weight:700;">${this._escapeHtml(title)}</div>
                <div style="padding:0 16px 14px; color:#555; font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-word; overflow:auto;">${this._escapeHtml(message)}</div>
                <div style="padding:10px 14px 14px; border-top:1px solid #eee;">
                    <button type="button" id="honey-image-error-close" style="width:100%; height:34px; border:none; border-radius:9px; background:#ff4785; color:#fff; font-size:13px; font-weight:700; cursor:pointer;">知道了</button>
                </div>
            </div>
        `;
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#honey-image-error-close')?.addEventListener('click', close);
        host.appendChild(overlay);
    }

    _formatFollowDateLabel(dateKey) {
        const raw = String(dateKey || '').trim();
        const chunks = raw.match(/\d+/g) || [];
        if (chunks.length >= 3) {
            const y = chunks[0].padStart(4, '0').slice(-4);
            const m = chunks[1].padStart(2, '0').slice(-2);
            const d = chunks[2].padStart(2, '0').slice(-2);
            return `${y}年${m}月${d}日`;
        }
        return raw || '未知日期';
    }

    _formatFollowVideoName(videoUrl) {
        const raw = String(videoUrl || '').trim();
        if (!raw) return '未命名视频';
        const part = raw.split('/').pop() || raw;
        return part.split('?')[0] || '未命名视频';
    }

    _resolveFollowFigureTag(hostName = '', storedFigure = '') {
        const explicit = String(storedFigure || '').trim();
        if (explicit && explicit !== '魅魔') return explicit;

        const pool = [
            '魅魔', '夜魅', '甜欲', '霓心', '绮夜', '月诱',
            '心狩', '幻欲', '深吻', '暧昧系', '午夜系', '心动系'
        ];
        const key = String(hostName || '').trim();
        if (!key) return pool[0];
        const idx = this._simpleHash(key) % pool.length;
        return pool[idx] || pool[0];
    }

    _formatCoinDisplay(value) {
        const num = Number.parseFloat(value);
        const safe = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
        return safe.toLocaleString('zh-CN');
    }

    _formatAudienceCountDisplay(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '0';
        if (/[kKwW]$/.test(raw)) return raw;

        const normalized = raw.replace(/,/g, '');
        const num = Number.parseFloat(normalized);
        if (!Number.isFinite(num)) return raw;

        const safe = Math.max(0, num);
        if (safe < 1000) return `${Math.floor(safe)}`;

        const compact = Math.floor(safe / 100) / 10;
        const compactText = Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1);
        return `${compactText}k`;
    }

    _formatMoneyDisplay(value) {
        const num = Number.parseFloat(value);
        const safe = Number.isFinite(num) ? Math.max(0, num) : 0;
        return safe.toFixed(2);
    }

    _sumAudienceGiftTotals(totals = {}) {
        const normalized = this._getSceneAudienceGiftTotals({ audienceGiftTotals: totals });
        return Object.values(normalized).reduce((sum, value) => {
            const amount = Math.max(0, Math.round(Number(value) || 0));
            return sum + amount;
        }, 0);
    }

    _extractGiftSenderFromText(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';

        const senderPatterns = [
            /^(.{1,24}?)(?:打赏了|送出|赠送|贡献了?)/,
            /^(.{1,24}?)\s*[：:]\s*(?:打赏|送出|赠送|贡献)/,
            /^(.{1,24}?)\s+(?:打赏|送出|赠送|贡献)/
        ];

        for (const pattern of senderPatterns) {
            const match = raw.match(pattern);
            const sender = this._normalizeLeaderboardName(match?.[1] || '');
            if (sender) return sender;
        }

        return '';
    }

    _buildLeaderboardFromAudienceTotals(totals = {}) {
        const normalized = this._getSceneAudienceGiftTotals({ audienceGiftTotals: totals });
        const sorted = Object.entries(normalized)
            .map(([name, amount]) => ({
                name,
                amount: Math.max(0, Math.round(Number(amount) || 0))
            }))
            .filter(item => item.name && item.amount > 0)
            .sort((a, b) => {
                if (b.amount !== a.amount) return b.amount - a.amount;
                return String(a.name).localeCompare(String(b.name), 'zh-CN');
            });

        return {
            top3: sorted.slice(0, 3).map((item, idx) => ({
                rank: idx + 1,
                name: item.name,
                coins: this._formatLeaderboardCoinsFromNumber(item.amount)
            })),
            userRank: null
        };
    }

    _normalizeLiveCollabRequest(item) {
        if (!item || typeof item !== 'object') return null;
        const name = this._normalizeLeaderboardName(item.name || item.nickname || item.user || item.hostName || '');
        if (!name) return null;
        const rawType = String(item.requestType || item.sourceType || item.type || item.source || 'viewer').trim().toLowerCase();
        const requestType = /host|主播|其他直播间|streamer|anchor|broadcaster/.test(rawType) ? 'host' : 'viewer';
        return {
            key: `${requestType}::${name}::${String(item.hostType || '').trim().toLowerCase()}`,
            name,
            requestType,
            hostType: String(item.hostType || item.figure || item.category || item.role || '').trim().slice(0, 24),
            rankHint: String(item.rankHint || item.rankLabel || item.rank || item.leaderboard || '').trim().slice(0, 24)
        };
    }

    _normalizeLiveCollabRequests(list = []) {
        return (Array.isArray(list) ? list : [])
            .map(item => this._normalizeLiveCollabRequest(item))
            .filter(Boolean);
    }

    _mergeLiveCollabRequests(current = [], incoming = []) {
        const merged = [];
        const seen = new Map();
        [...this._normalizeLiveCollabRequests(current), ...this._normalizeLiveCollabRequests(incoming)].forEach((item) => {
            if (!item?.key) return;
            if (seen.has(item.key)) {
                const prevIndex = seen.get(item.key);
                merged[prevIndex] = { ...merged[prevIndex], ...item };
                return;
            }
            seen.set(item.key, merged.length);
            merged.push(item);
        });
        return merged.slice(0, 6);
    }

    _getLiveCollabRequestFingerprint(list = []) {
        return this._normalizeLiveCollabRequests(list)
            .map(item => item.key)
            .sort((a, b) => String(a).localeCompare(String(b)))
            .join('|');
    }

    _getAudienceRankMap(scene = null) {
        const totals = this._getSceneAudienceGiftTotals(scene || this.currentSceneData);
        const sorted = Object.entries(totals)
            .map(([name, amount]) => ({
                name: this._normalizeLeaderboardName(name),
                amount: Math.max(0, Math.round(Number(amount) || 0))
            }))
            .filter(item => item.name && item.amount > 0)
            .sort((a, b) => {
                if (b.amount !== a.amount) return b.amount - a.amount;
                return String(a.name).localeCompare(String(b.name), 'zh-CN');
            });

        const rankMap = new Map();
        sorted.forEach((item, idx) => {
            rankMap.set(item.name, {
                rank: idx + 1,
                amount: item.amount
            });
        });
        return rankMap;
    }

    _getEnrichedLiveCollabRequests(scene = null) {
        const sourceScene = scene || this.currentSceneData || {};
        const rankMap = this._getAudienceRankMap(sourceScene);
        return this._normalizeLiveCollabRequests(sourceScene?.collabRequests || []).map((item) => {
            const rankInfo = rankMap.get(this._normalizeLeaderboardName(item.name));
            let computedRankLabel = '';
            if (rankInfo?.rank) {
                computedRankLabel = `榜单 #${rankInfo.rank}`;
            } else if (item.requestType === 'viewer') {
                computedRankLabel = '未上榜';
            }

            return {
                ...item,
                rank: rankInfo?.rank || 0,
                amount: rankInfo?.amount || 0,
                rankLabel: computedRankLabel || item.rankHint || '',
                sourceLabel: item.requestType === 'host' ? '其他直播间请求联播' : '网友申请联播',
                typeLabel: item.requestType === 'host'
                    ? (item.hostType || '其他主播')
                    : (computedRankLabel || item.rankHint || '普通观众')
            };
        });
    }

    _shouldShowLiveCollabRequestModal(scene = null) {
        const sourceScene = scene || this.currentSceneData || {};
        if (!this._isUserLiveScene(sourceScene)) return false;
        if (this._normalizeLiveCollabName(sourceScene?.collab) !== '无') return false;
        const requests = this._normalizeLiveCollabRequests(sourceScene?.collabRequests || []);
        if (!requests.length) return false;
        const fingerprint = this._getLiveCollabRequestFingerprint(requests);
        if (!fingerprint) return false;
        return fingerprint !== this._dismissedLiveCollabRequestFingerprint;
    }

    _buildLiveCollabRequestModalHtml(scene = null) {
        const sourceScene = scene || this.currentSceneData || {};
        if (!this._shouldShowLiveCollabRequestModal(sourceScene)) return '';

        const requestRows = this._getEnrichedLiveCollabRequests(sourceScene)
            .sort((a, b) => {
                const scoreA = a.requestType === 'viewer' && a.rank ? 0 : (a.requestType === 'host' ? 1 : 2);
                const scoreB = b.requestType === 'viewer' && b.rank ? 0 : (b.requestType === 'host' ? 1 : 2);
                if (scoreA !== scoreB) return scoreA - scoreB;
                if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 99) - (b.rank || 99);
                return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
            })
            .map((item) => `
                <button class="honey-live-collab-request-item" type="button" data-live-collab-action="accept" data-request-key="${this._escapeHtml(item.key)}">
                    <span class="honey-live-collab-request-top">
                        <span class="honey-live-collab-request-name">${this._escapeHtml(item.name)}</span>
                        <span class="honey-live-collab-request-badge ${item.requestType === 'host' ? 'is-host' : (item.rank ? 'is-ranked' : 'is-unranked')}">${this._escapeHtml(item.typeLabel)}</span>
                    </span>
                    <span class="honey-live-collab-request-sub">${this._escapeHtml(item.sourceLabel)}</span>
                    <span class="honey-live-collab-request-cta">点击接通</span>
                </button>
            `)
            .join('');

        return `
            <div class="honey-live-collab-modal" id="honey-live-collab-modal">
                <button class="honey-live-collab-modal-backdrop" type="button" data-live-collab-action="dismiss" aria-label="关闭联播通知"></button>
                <div class="honey-live-collab-modal-panel" role="dialog" aria-modal="true" aria-label="联播通知">
                    <div class="honey-live-collab-modal-head">
                        <div class="honey-live-collab-modal-title">联播通知</div>
                        <button class="honey-live-collab-modal-close" type="button" data-live-collab-action="dismiss" aria-label="关闭联播通知">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="honey-live-collab-modal-desc">有新的联播申请，已按当前榜单状态标注。选择一个即可接通。</div>
                    <div class="honey-live-collab-modal-list">${requestRows}</div>
                </div>
            </div>
        `;
    }

    _buildLiveCollabButtonHtml({
        isUserLive = false,
        collabNick = '无',
        collabTitleText = '',
        userLiveCollabLabel = '暂无联播',
        collabLabel = '申请联播',
        collabCost = 0
    } = {}) {
        const safeTitle = this._escapeHtml(collabTitleText || '');
        if (isUserLive) {
            if (collabNick !== '无') {
                return `
                    <button
                        class="honey-meta-collab-btn"
                        id="honey-ui-collab"
                        type="button"
                        title="${safeTitle}"
                        data-live-collab-action="prompt-end-collab"
                        data-collab-name="${this._escapeHtml(collabNick)}"
                    >${this._escapeHtml(userLiveCollabLabel)}</button>
                `;
            }
            return `<span class="honey-meta-collab-btn is-empty" id="honey-ui-collab" title="${safeTitle}">${this._escapeHtml(userLiveCollabLabel)}</span>`;
        }

        return `
            <button
                class="honey-meta-collab-btn ${collabNick === '无' ? 'is-empty' : ''}"
                id="honey-collab-btn"
                data-collab-name="${this._escapeHtml(collabNick)}"
                data-collab-cost="${collabCost}"
                type="button"
                title="${safeTitle}"
            >${this._escapeHtml(collabLabel)}</button>
        `;
    }

    _buildLiveCollabEndModalHtml(scene = null) {
        const sourceScene = scene || this.currentSceneData || {};
        const collabNick = this._normalizeLiveCollabName(sourceScene?.collab);
        if (!this._isEndCollabConfirmOpen || !this._isUserLiveScene(sourceScene) || collabNick === '无') return '';

        const collabInfo = this._normalizeLiveCollabRequest(sourceScene?.collabRequestInfo || null);
        const metaText = collabInfo?.hostType
            ? ` · ${collabInfo.hostType}`
            : (collabInfo?.rankHint ? ` · ${collabInfo.rankHint}` : '');

        return `
            <div class="honey-live-collab-modal" id="honey-live-collab-end-modal">
                <button class="honey-live-collab-modal-backdrop" type="button" data-live-collab-action="cancel-end-collab" aria-label="关闭结束联播确认"></button>
                <div class="honey-live-collab-modal-panel" role="dialog" aria-modal="true" aria-label="结束联播确认">
                    <div class="honey-live-collab-modal-head">
                        <div class="honey-live-collab-modal-title">结束联播</div>
                        <button class="honey-live-collab-modal-close" type="button" data-live-collab-action="cancel-end-collab" aria-label="关闭结束联播确认">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div class="honey-live-collab-modal-desc">确定要与 ${this._escapeHtml(collabNick)}${this._escapeHtml(metaText)} 结束当前联播吗？挂断后直播不会结束，你可以继续自己发内容，或等待下一次联播申请。</div>
                    <div class="honey-live-collab-end-actions">
                        <button class="honey-follow-action-btn" type="button" data-live-collab-action="cancel-end-collab">继续联播</button>
                        <button class="honey-follow-action-btn is-danger" type="button" data-live-collab-action="confirm-end-collab">结束联播</button>
                    </div>
                </div>
            </div>
        `;
    }

    _dismissLiveCollabRequestModal() {
        const fingerprint = this._getLiveCollabRequestFingerprint(this.currentSceneData?.collabRequests || []);
        this._dismissedLiveCollabRequestFingerprint = fingerprint || '';
        this._refreshLivePageDom();
    }

    _openLiveCollabEndConfirm() {
        if (!this.currentSceneData || !this._isUserLiveScene(this.currentSceneData)) return;
        if (this._normalizeLiveCollabName(this.currentSceneData?.collab) === '无') return;
        const liveInputState = this._captureLiveChatInputState();
        this._isEndCollabConfirmOpen = true;
        this._refreshLivePageDom();
        this._restoreLiveChatInputState(liveInputState);
    }

    _closeLiveCollabEndConfirm() {
        if (!this._isEndCollabConfirmOpen) return;
        const liveInputState = this._captureLiveChatInputState();
        this._isEndCollabConfirmOpen = false;
        this._refreshLivePageDom();
        this._restoreLiveChatInputState(liveInputState);
    }

    _acceptLiveCollabRequest(requestKey = '') {
        if (!this.currentSceneData || !this._isUserLiveScene(this.currentSceneData)) return;
        const requests = this._getEnrichedLiveCollabRequests(this.currentSceneData);
        const picked = requests.find(item => item.key === requestKey);
        if (!picked) return;

        this.currentSceneData = {
            ...this.currentSceneData,
            collab: picked.name,
            collabRequestInfo: {
                name: picked.name,
                requestType: picked.requestType,
                hostType: picked.hostType,
                rankHint: picked.rankLabel || picked.rankHint || ''
            },
            collabRequests: [],
            description: `已接通与${picked.name}${picked.hostType ? `（${picked.hostType}）` : ''}的联播，等待 AI 继续推进互动。`
        };
        if (this.selectedTopic && this._isUserLiveScene(this.selectedTopic)) {
            this.selectedTopic = {
                ...this.selectedTopic,
                collab: picked.name
            };
        }
        this._dismissedLiveCollabRequestFingerprint = '';
        this._isEndCollabConfirmOpen = false;
        this._persistCurrentScene();
        this._refreshLivePageDom({ scene: this.currentSceneData });
        this.app?.phoneShell?.showNotification?.('联播已接通', `${picked.name}${picked.hostType ? ` · ${picked.hostType}` : ''}`, '📡');
    }

    _endCurrentLiveCollab() {
        if (!this.currentSceneData || !this._isUserLiveScene(this.currentSceneData)) return;
        const previousCollab = this._normalizeLiveCollabName(this.currentSceneData?.collab);
        if (previousCollab === '无') {
            this._closeLiveCollabEndConfirm();
            return;
        }
        const liveInputState = this._captureLiveChatInputState();

        this.currentSceneData = {
            ...this.currentSceneData,
            collab: '无',
            collabCost: 0,
            collabRequestInfo: null,
            description: '当前暂无联播剧情，直播主要通过弹幕滚动推进。'
        };
        if (this.selectedTopic && this._isUserLiveScene(this.selectedTopic)) {
            this.selectedTopic = {
                ...this.selectedTopic,
                collab: '无'
            };
        }
        this._dismissedLiveCollabRequestFingerprint = '';
        this._isEndCollabConfirmOpen = false;
        this._persistCurrentScene();
        this._refreshLivePageDom({ scene: this.currentSceneData });
        this._restoreLiveChatInputState(liveInputState);
        this.app?.phoneShell?.showNotification?.('联播已结束', `${previousCollab} 已挂断`, '📴');
    }

    _accumulateAudienceGiftTotalsFromGiftLines(baseTotals = {}, giftLines = [], options = {}) {
        const totals = {
            ...this._getSceneAudienceGiftTotals({ audienceGiftTotals: baseTotals })
        };
        const excludedNames = new Set(
            (Array.isArray(options?.excludeNames) ? options.excludeNames : [])
                .map(name => this._normalizeLeaderboardName(name))
                .filter(Boolean)
        );

        (Array.isArray(giftLines) ? giftLines : []).forEach((line) => {
            const senderName = this._extractGiftSenderFromText(line);
            const giftAmount = Math.max(0, Math.round(this._extractGiftAmountFromText(line)));
            if (!senderName || giftAmount <= 0 || excludedNames.has(senderName)) return;
            const current = Math.max(0, Math.round(Number(totals[senderName] || 0)));
            totals[senderName] = current + giftAmount;
        });

        return totals;
    }

    _getCurrentUserLiveIncomeCoins(scene = null) {
        return this._sumAudienceGiftTotals(this._getSceneAudienceGiftTotals(scene || this.currentSceneData));
    }

    _normalizeLeaderboardName(name = '') {
        return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    }

    _normalizeGiftTokenText(text = '') {
        return String(text || '')
            .replace(/\uFE0F/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _parseLeaderboardCoinsToNumber(rawValue = '') {
        let raw = String(rawValue || '').trim();
        if (!raw) return 0;
        raw = raw.replace(/[，,]/g, '').replace(/\s+/g, '').toUpperCase();
        raw = raw.replace(/(?:金币|金豆|币)$/i, '');
        if (!raw) return 0;

        if (/^\d+(?:\.\d+)?WG$/.test(raw)) {
            const num = Number.parseFloat(raw.replace(/WG$/, ''));
            return Number.isFinite(num) ? Math.max(0, Math.round(num * 10000)) : 0;
        }
        if (/^\d+(?:\.\d+)?KG$/.test(raw)) {
            const num = Number.parseFloat(raw.replace(/KG$/, ''));
            return Number.isFinite(num) ? Math.max(0, Math.round(num * 1000)) : 0;
        }
        if (/^\d+(?:\.\d+)?W$/.test(raw)) {
            const num = Number.parseFloat(raw.replace(/W$/, ''));
            return Number.isFinite(num) ? Math.max(0, Math.round(num * 10000)) : 0;
        }
        if (/^\d+(?:\.\d+)?万$/.test(raw)) {
            const num = Number.parseFloat(raw.replace(/万$/, ''));
            return Number.isFinite(num) ? Math.max(0, Math.round(num * 10000)) : 0;
        }
        if (/^\d+(?:\.\d+)?G$/.test(raw)) {
            const num = Number.parseFloat(raw.replace(/G$/, ''));
            return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
        }
        if (/^\d+(?:\.\d+)?$/.test(raw)) {
            const num = Number.parseFloat(raw);
            return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
        }
        return 0;
    }

    _formatLeaderboardCoinsFromNumber(value) {
        const amount = Math.max(0, Math.round(Number(value) || 0));
        if (amount >= 10000) {
            const w = amount / 10000;
            const text = Number.isInteger(w) ? String(w) : String(Math.round(w * 10) / 10).replace(/\.0$/, '');
            return `${text}WG`;
        }
        if (amount >= 1000) {
            const k = amount / 1000;
            const text = Number.isInteger(k) ? String(k) : String(Math.round(k * 10) / 10).replace(/\.0$/, '');
            return `${text}kG`;
        }
        return `${amount}G`;
    }

    _getSceneAudienceGiftTotals(scene = null) {
        const source = scene && typeof scene === 'object' ? scene : {};
        const rawTotals = (source.audienceGiftTotals && typeof source.audienceGiftTotals === 'object')
            ? source.audienceGiftTotals
            : {};
        const normalized = {};
        Object.keys(rawTotals).forEach((name) => {
            const safeName = this._normalizeLeaderboardName(name);
            const value = Math.max(0, Math.round(Number(rawTotals[name]) || 0));
            if (!safeName || value <= 0) return;
            normalized[safeName] = value;
        });
        return normalized;
    }

    _buildMergedLeaderboardWithUser(baseLeaderboard = [], userName = '', userTotal = 0) {
        const userSafeName = this._normalizeLeaderboardName(userName);
        const safeUserTotal = Math.max(0, Math.round(Number(userTotal) || 0));
        const items = Array.isArray(baseLeaderboard) ? baseLeaderboard : [];
        const mergedMap = new Map();

        items.forEach((item, idx) => {
            const name = this._normalizeLeaderboardName(item?.name || '');
            if (!name) return;
            if (userSafeName && name === userSafeName) return;
            const coinsText = String(item?.coins || '').trim();
            const amount = this._parseLeaderboardCoinsToNumber(item?.coins || '');
            const sourceRank = Number(item?.rank) || (idx + 1);
            const prev = mergedMap.get(name);
            if (!prev) {
                mergedMap.set(name, { name, amount, sourceRank, coinsText });
                return;
            }
            mergedMap.set(name, {
                name,
                amount: Math.max(prev.amount, amount),
                sourceRank: Math.min(prev.sourceRank, sourceRank),
                coinsText: prev.coinsText || coinsText
            });
        });

        if (userSafeName && safeUserTotal > 0) {
            const prev = mergedMap.get(userSafeName);
            mergedMap.set(userSafeName, {
                name: userSafeName,
                amount: safeUserTotal,
                sourceRank: prev?.sourceRank || 999,
                coinsText: this._formatLeaderboardCoinsFromNumber(safeUserTotal)
            });
        }

        const sorted = Array.from(mergedMap.values())
            .sort((a, b) => {
                if (b.amount !== a.amount) return b.amount - a.amount;
                if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
                return String(a.name).localeCompare(String(b.name), 'zh-CN');
            });

        const top3 = sorted.slice(0, 3).map((item, idx) => ({
            rank: idx + 1,
            name: item.name,
            coins: item.amount > 0
                ? this._formatLeaderboardCoinsFromNumber(item.amount)
                : (String(item.coinsText || '').trim() || '--')
        }));

        let userRank = null;
        if (userSafeName && safeUserTotal > 0) {
            const userEntry = mergedMap.get(userSafeName);
            const effectiveUserTotal = Math.max(0, Math.round(Number(userEntry?.amount) || 0));
            const index = sorted.findIndex(item => item.name === userSafeName);
            const rank = index >= 0 ? (index + 1) : 4;
            userRank = {
                rank,
                name: userSafeName,
                coins: this._formatLeaderboardCoinsFromNumber(effectiveUserTotal)
            };
        }

        return { top3, userRank };
    }

    _normalizeLiveCollabName(rawValue = '') {
        const source = String(rawValue || '')
            .replace(/[【】\[\]]/g, ' ')
            .replace(/联播\s*[：:]/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!source) return '无';

        const parts = source
            .split(/[\/|、,，]/)
            .map(item => String(item || '').trim())
            .filter(Boolean);
        const picked = parts.find(item => !/^(?:无|none|null|暂无|未联播)$/i.test(item));
        if (picked) return picked;
        return '无';
    }

    _normalizeFavorability(value, fallback = 0) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.max(0, Math.min(100, num));
        return Math.round(clamped * 10) / 10;
    }

    _extractGiftAmountFromText(text) {
        const raw = String(text || '').trim();
        if (!raw) return 0;

        const explicitAmountMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:金币|金豆|元|块|RMB|rmb|¥)/);
        if (explicitAmountMatch) {
            const explicitAmount = Number.parseFloat(explicitAmountMatch[1]);
            return Number.isFinite(explicitAmount) ? Math.max(0, explicitAmount) : 0;
        }

        const normalizedRaw = this._normalizeGiftTokenText(raw);
        const gift = (Array.isArray(this.giftOptions) ? this.giftOptions : []).find((item) => {
            const giftName = String(item?.name || '').trim();
            const giftIcon = this._normalizeGiftTokenText(item?.icon || '');
            return (!!giftName && raw.includes(giftName))
                || (!!giftIcon && normalizedRaw.includes(giftIcon));
        });
        if (!gift) return 0;

        const qtyMatch = raw.match(/(?:x|×)\s*([0-9]{1,4})/i)
            || raw.match(/(?:数量|份数)\s*[：:]\s*([0-9]{1,4})/i);
        const qty = qtyMatch
            ? Math.max(1, Math.min(999, Number.parseInt(qtyMatch[1], 10) || 1))
            : 1;
        const unitPrice = Number(gift.price) || 0;
        return Math.max(0, unitPrice * qty);
    }

    _computeFavorabilityGainByGiftAmount(amount) {
        const safeAmount = Number(amount) || 0;
        if (safeAmount < 1) return 0;
        if (safeAmount < 10) return 0.1;
        if (safeAmount < 100) return 0.2;
        if (safeAmount < 500) return 0.4;
        if (safeAmount < 2000) return 0.7;
        if (safeAmount < 10000) return 1.0;
        if (safeAmount < 50000) return 1.4;
        return 1.8;
    }

    _applyGiftFavorabilityToFollowHost(hostName, giftText) {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return { updated: false, favorability: null, delta: 0, amount: 0 };

        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const followedHost = followedHosts.find((item) => this._isSameHostName(item?.name, safeHostName));
        if (!followedHost) return { updated: false, favorability: null, delta: 0, amount: 0 };

        const giftAmount = this._extractGiftAmountFromText(giftText);
        const gain = this._computeFavorabilityGainByGiftAmount(giftAmount);
        if (gain <= 0) {
            return {
                updated: false,
                favorability: this._normalizeFavorability(followedHost?.favorability ?? followedHost?.affection, 0),
                delta: 0,
                amount: giftAmount
            };
        }

        const previousFavorability = this._normalizeFavorability(followedHost?.favorability ?? followedHost?.affection, 0);
        const nextFavorability = this._normalizeFavorability(previousFavorability + gain, previousFavorability);
        this.app?.honeyData?.updateFollowedHost?.(followedHost.name, {
            favorability: nextFavorability,
            lastActiveAt: Date.now()
        });

        return {
            updated: nextFavorability > previousFavorability,
            favorability: nextFavorability,
            delta: this._normalizeFavorability(nextFavorability - previousFavorability, 0),
            amount: giftAmount
        };
    }

    _resolveFollowFavorabilityAfterAi(hostName, aiFavorability, userMessage = '') {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return null;

        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const followedHost = followedHosts.find((item) => this._isSameHostName(item?.name, safeHostName));
        if (!followedHost) return null;

        const previousFavorability = this._normalizeFavorability(followedHost?.favorability ?? followedHost?.affection, 0);
        const parsedAiFavorability = this._normalizeFavorability(aiFavorability, null);
        const giftAmountFromMessage = this._extractGiftAmountFromText(userMessage);

        // 严格规则：无送礼则本轮不涨好感度
        if (giftAmountFromMessage <= 0) {
            return previousFavorability;
        }

        const maxDelta = this._computeFavorabilityGainByGiftAmount(giftAmountFromMessage);
        if (maxDelta <= 0) return previousFavorability;

        const maxAllowed = this._normalizeFavorability(previousFavorability + maxDelta, previousFavorability);
        const candidate = parsedAiFavorability === null ? maxAllowed : parsedAiFavorability;
        const resolved = this._normalizeFavorability(
            Math.min(maxAllowed, Math.max(previousFavorability, candidate)),
            previousFavorability
        );

        if (resolved > previousFavorability) {
            this.app?.honeyData?.updateFollowedHost?.(followedHost.name, {
                favorability: resolved,
                lastActiveAt: Date.now()
            });
        }
        return resolved;
    }

    _normalizeHostNameKey(name) {
        return String(name || '')
            .replace(/\s*[（(]\s*(?:已关注|未关注)\s*[)）]\s*$/g, '')
            .replace(/\s+/g, '')
            .trim()
            .toLowerCase();
    }

    _isSameHostName(left, right) {
        const leftKey = this._normalizeHostNameKey(left);
        const rightKey = this._normalizeHostNameKey(right);
        return !!leftKey && !!rightKey && leftKey === rightKey;
    }

    _buildOnlineTopicMap() {
        const map = new Map();
        const appendTopic = (topic) => {
            if (!topic || typeof topic !== 'object') return;
            const hostKey = this._normalizeHostNameKey(topic?.host);
            if (!hostKey) return;
            if (!map.has(hostKey)) {
                map.set(hostKey, topic);
            }
        };

        const topics = Array.isArray(this.recommendTopics) ? this.recommendTopics : [];
        topics.forEach((topic) => {
            appendTopic(topic);
        });

        // 关注页在线判定：除了热门推荐池，也纳入当前激情直播中的主播
        const runtimeTopics = [this.currentSceneData, this.selectedTopic]
            .filter(item => item && typeof item === 'object')
            .map((item) => ({
                ...item,
                _topicKey: String(item?._topicKey || '').trim(),
                title: String(item?.title || item?._topicTitle || '直播间').trim() || '直播间'
            }));
        runtimeTopics.forEach((topic) => appendTopic(topic));

        return map;
    }

    _isFollowHostOnline(hostName, onlineTopicMap = null) {
        const hostKey = this._normalizeHostNameKey(hostName);
        if (!hostKey) return false;
        const map = onlineTopicMap instanceof Map ? onlineTopicMap : this._buildOnlineTopicMap();
        return map.has(hostKey);
    }

    _findOnlineTopicByHostName(hostName, onlineTopicMap = null) {
        const hostKey = this._normalizeHostNameKey(hostName);
        if (!hostKey) return null;
        const map = onlineTopicMap instanceof Map ? onlineTopicMap : this._buildOnlineTopicMap();
        return map.get(hostKey) || null;
    }

    _getCurrentStoryDateOrSystem() {
        const storyDateRaw = String(window.VirtualPhone?.timeManager?.getCurrentStoryTime?.()?.date || '').trim();
        const chunks = storyDateRaw.match(/\d+/g) || [];
        if (chunks.length >= 3) {
            const y = chunks[0].padStart(4, '0').slice(-4);
            const m = chunks[1].padStart(2, '0').slice(-2);
            const d = chunks[2].padStart(2, '0').slice(-2);
            return `${y}-${m}-${d}`;
        }
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    _resolveLiveBackTarget(topicKey = '', options = {}) {
        const explicit = String(options?.backTarget || '').trim().toLowerCase();
        if (explicit === 'recommend' || explicit === 'home' || explicit === 'follow' || explicit === 'mine') return explicit;
        const safeTopicKey = String(topicKey || '').trim();
        if (safeTopicKey === 'topic_direct_live') return 'home';
        if (safeTopicKey === 'topic_user_live') return 'mine';
        return 'recommend';
    }

    _navigateBackFromLive() {
        const resolvedBackTarget = this._resolveLiveBackTargetBySource();
        if (resolvedBackTarget === 'recommend') {
            this.currentPage = 'recommend';
            this.render();
            return;
        }
        if (resolvedBackTarget === 'follow') {
            this.currentPage = 'follow';
            this.render();
            return;
        }
        if (resolvedBackTarget === 'mine') {
            this.currentPage = 'mine';
            this.render();
            return;
        }
        this.removePhoneChromeTheme();
        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    _resolveLiveBackTargetBySource() {
        const explicit = String(this._liveBackTarget || '').trim().toLowerCase();
        if (explicit === 'follow') return 'follow';
        if (explicit === 'recommend') return 'recommend';
        if (explicit === 'mine') return 'mine';
        if (explicit === 'home') return 'home';

        if (this._liveEntrySource === 'direct') return 'home';
        if (this._liveEntrySource === 'recommend') return 'recommend';
        if (this._liveEntrySource === 'follow') return 'follow';
        if (this._liveEntrySource === 'mine') return 'mine';
        const activeKey = String(this.selectedTopic?._topicKey || this.currentSceneData?._topicKey || '').trim();
        const activeTitle = String(this.selectedTopic?.title || this.currentSceneData?._topicTitle || this.currentSceneData?.title || '').trim();

        // 直接点击“激情直播”进入的专属入口，始终直接返回手机主页
        if (activeKey === 'topic_direct_live') return 'home';
        if (activeKey === 'topic_user_live') return 'mine';

        if (activeKey) {
            const inRecommendByKey = Array.isArray(this.recommendTopics) && this.recommendTopics.some(item => String(item?._topicKey || '').trim() === activeKey);
            if (inRecommendByKey) return 'recommend';
        }

        if (activeTitle) {
            const inRecommendByTitle = Array.isArray(this.recommendTopics) && this.recommendTopics.some(item => String(item?.title || '').trim() === activeTitle);
            if (inRecommendByTitle) return 'recommend';
        }

        return 'home';
    }

    _captureLiveChatInputState(root = null) {
        const liveRoot = root
            || document.querySelector('.phone-view-current .honey-page-live')
            || document.querySelector('.honey-page-live');
        const input = liveRoot?.querySelector?.('#honey-chat-input');
        const hasSelection = !!input && typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number';
        return {
            value: String(input?.value || ''),
            placeholder: String(input?.placeholder || ''),
            hadFocus: !!input && (document.activeElement === input),
            selectionStart: hasSelection ? input.selectionStart : null,
            selectionEnd: hasSelection ? input.selectionEnd : null
        };
    }

    _restoreLiveChatInputState(state = null) {
        if (!state || this.currentPage !== 'live') return;
        const liveRoot = document.querySelector('.phone-view-current .honey-page-live')
            || document.querySelector('.honey-page-live');
        const input = liveRoot?.querySelector?.('#honey-chat-input');
        if (!input) return;
        input.value = String(state.value || '');
        if (state.placeholder) input.placeholder = state.placeholder;
        if (state.hadFocus && !input.disabled) {
            input.focus();
            const fallbackCaret = input.value.length;
            const selectionStart = Number.isInteger(state.selectionStart) ? state.selectionStart : fallbackCaret;
            const selectionEnd = Number.isInteger(state.selectionEnd) ? state.selectionEnd : selectionStart;
            input.setSelectionRange(
                Math.max(0, Math.min(selectionStart, input.value.length)),
                Math.max(0, Math.min(selectionEnd, input.value.length))
            );
        }
    }

    _bindLiveKeyboardViewport(root = null) {
        if (this._liveViewportCleanup) {
            this._liveViewportCleanup();
            this._liveViewportCleanup = null;
        }

        const liveRoot = this._getLiveRoot(root);
        if (!liveRoot) return;
        const input = liveRoot.querySelector('#honey-chat-input');
        if (!input) return;

        // 采用和微信完全一致的原生 Flexbox 自动适应 + body 状态标记方案
        const handleFocus = () => {
            if (window.innerWidth <= 500) {
                document.body.classList.add('phone-input-active');
            }
        };

        const handleBlur = () => {
            if (window.innerWidth <= 500) {
                setTimeout(() => {
                    if (document.activeElement !== input) {
                        document.body.classList.remove('phone-input-active');
                    }
                }, 100);
            }
        };

        input.addEventListener('focus', handleFocus);
        input.addEventListener('blur', handleBlur);

        this._liveViewportCleanup = () => {
            input.removeEventListener('focus', handleFocus);
            input.removeEventListener('blur', handleBlur);
            document.body.classList.remove('phone-input-active');
        };
    }

    _finalizeEndedUserLiveSession() {
        const topicTitle = String(this.currentSceneData?._topicTitle || this.selectedTopic?.title || '').trim();
        const topicKey = String(this.currentSceneData?._topicKey || this.selectedTopic?._topicKey || '').trim();

        this.app?.honeyData?.clearTopicScene?.(topicKey || topicTitle, {
            clearLastSceneIfMatch: true,
            fallbackTitle: topicTitle,
            topicKey
        });
        this.app?.honeyData?.saveSelectedTopicTitle?.('');
        this.app?.honeyData?.saveSelectedTopicKey?.('');

        this._activeLiveSettlement = null;
        this.currentSceneData = null;
        this.selectedTopic = null;
        this.isScenePanelOpen = false;
        this._isSceneTagHistoryOpen = false;
        this.currentPage = 'mine';
        this.render();
    }

    _showUserLiveSettlementDialog() {
        if (!this._isUserLiveScene(this.currentSceneData)) return;

        const root = document.querySelector('.phone-view-current .honey-page-live')
            || document.querySelector('.honey-page-live');
        if (!root) return;
        if (root.querySelector('#honey-live-settlement-modal')) return;

        const incomeCoins = this._getCurrentUserLiveIncomeCoins(this.currentSceneData);
        const incomeYuan = Math.round((incomeCoins / 10) * 100) / 100;
        const balanceBefore = this.app?.honeyData?.getHoneyCoinBalance?.() || 0;
        const balanceAfter = incomeCoins > 0
            ? (this.app?.honeyData?.updateHoneyCoinBalance?.(incomeCoins) ?? balanceBefore)
            : balanceBefore;

        this._activeLiveSettlement = {
            incomeCoins,
            incomeYuan,
            balanceAfter,
            withdrawn: false
        };

        const settledTopicTitle = String(this.currentSceneData?._topicTitle || this.selectedTopic?.title || '').trim();
        const settledTopicKey = String(this.currentSceneData?._topicKey || this.selectedTopic?._topicKey || '').trim();
        this.app?.honeyData?.clearTopicScene?.(settledTopicKey || settledTopicTitle, {
            clearLastSceneIfMatch: true,
            fallbackTitle: settledTopicTitle,
            topicKey: settledTopicKey
        });
        this.app?.honeyData?.saveSelectedTopicTitle?.('');
        this.app?.honeyData?.saveSelectedTopicKey?.('');

        const html = `
            <div id="honey-live-settlement-modal" style="position:absolute; inset:0; z-index:2600; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; background:rgba(0,0,0,0.42);">
                <div style="width:100%; max-width:320px; border-radius:18px; overflow:hidden; background:linear-gradient(180deg, rgba(34,17,28,0.98), rgba(25,12,22,0.98)); border:1px solid rgba(255,255,255,0.08); box-shadow:0 20px 50px rgba(0,0,0,0.35);">
                    <div style="padding:18px 18px 10px; text-align:center;">
                        <div style="font-size:18px; font-weight:700; color:#ffe3ef;">直播已结束</div>
                        <div style="margin-top:6px; font-size:12px; color:rgba(255,227,239,0.7);">本次收益已存入蜜语金币余额</div>
                    </div>
                    <div style="padding:10px 18px 18px;">
                        <div style="padding:14px 16px; border-radius:14px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); text-align:center;">
                            <div style="font-size:12px; color:rgba(255,227,239,0.72);">本次直播收益</div>
                            <div style="margin-top:8px; font-size:28px; font-weight:700; color:#fff0f7;">${this._formatCoinDisplay(incomeCoins)} 金币</div>
                            <div style="margin-top:6px; font-size:12px; color:rgba(255,227,239,0.72);">约 ¥${this._formatMoneyDisplay(incomeYuan)}</div>
                        </div>
                        <div id="honey-live-settlement-status" style="margin-top:12px; font-size:12px; line-height:1.6; color:rgba(255,227,239,0.82);">
                            当前蜜语余额：${this._formatCoinDisplay(balanceAfter)} 金币
                        </div>
                        <div style="display:flex; gap:10px; margin-top:16px;">
                            <button id="honey-live-withdraw-btn" style="flex:1; height:38px; border:none; border-radius:10px; cursor:pointer; font-size:13px; font-weight:600; color:#fff; background:linear-gradient(135deg, #ff6fa7, #ff8a5b);">提现到微信</button>
                            <button id="honey-live-settlement-close" style="flex:1; height:38px; border:none; border-radius:10px; cursor:pointer; font-size:13px; font-weight:600; color:#2a1120; background:#ffe4ef;">完成</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        root.insertAdjacentHTML('beforeend', html);
        const modal = root.querySelector('#honey-live-settlement-modal');
        const statusEl = modal?.querySelector('#honey-live-settlement-status');
        const withdrawBtn = modal?.querySelector('#honey-live-withdraw-btn');
        const closeBtn = modal?.querySelector('#honey-live-settlement-close');

        const closeSettlement = () => {
            modal?.remove();
            this._finalizeEndedUserLiveSession();
        };

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) closeSettlement();
        });
        closeBtn?.addEventListener('click', closeSettlement);

        withdrawBtn?.addEventListener('click', () => {
            if (!this._activeLiveSettlement || this._activeLiveSettlement.withdrawn) return;
            if (incomeCoins <= 0) {
                this.app?.phoneShell?.showNotification?.('提现失败', '本次直播暂无可提现收益', 'ℹ️');
                return;
            }

            const result = this.app?.honeyData?.withdrawHoneyCoinsToWechat?.(incomeCoins);
            if (!result?.success) {
                if (result?.reason === 'coin_insufficient') {
                    this.app?.phoneShell?.showNotification?.('提现失败', '当前蜜语金币不足，无法提现', '⚠️');
                    return;
                }
                this.app?.phoneShell?.showNotification?.('提现失败', '微信钱包暂不可用', '⚠️');
                return;
            }

            this._activeLiveSettlement.withdrawn = true;
            if (statusEl) {
                statusEl.innerHTML = `当前蜜语余额：${this._formatCoinDisplay(result.balanceAfter || 0)} 金币<br>微信提现成功：¥${this._formatMoneyDisplay(result.amountYuan || 0)}，钱包余额 ¥${this._formatMoneyDisplay(result.walletAfter || 0)}`;
            }
            if (withdrawBtn) {
                withdrawBtn.disabled = true;
                withdrawBtn.textContent = '已提现';
                withdrawBtn.style.opacity = '0.6';
                withdrawBtn.style.cursor = 'default';
            }
            this.app?.phoneShell?.showNotification?.(
                '提现成功',
                `已转入微信钱包 ¥${this._formatMoneyDisplay(result.amountYuan || 0)}`,
                '✅'
            );
        });
    }

    _pushLiveGift(text, options = {}) {
        if (!this.currentSceneData) return;
        if (!Array.isArray(this.currentSceneData.gifts)) {
            this.currentSceneData.gifts = [];
        }

        this.currentSceneData.gifts.push(text);
        this.currentSceneData.gifts = this.currentSceneData.gifts.slice(-5);
        const senderName = this._normalizeLeaderboardName(options?.senderName || this.app?.honeyData?.getHoneyUserNickname?.() || '你');
        const giftAmount = Math.max(0, Math.round(Number(options?.giftAmount) || this._extractGiftAmountFromText(text)));
        if (senderName && giftAmount > 0) {
            const audienceGiftTotals = this._getSceneAudienceGiftTotals(this.currentSceneData);
            const current = Number(audienceGiftTotals[senderName] || 0);
            audienceGiftTotals[senderName] = Math.max(0, Math.round(current + giftAmount));
            this.currentSceneData.audienceGiftTotals = audienceGiftTotals;

            const mergedLeaderboard = this._buildMergedLeaderboardWithUser(
                this.currentSceneData?.leaderboard,
                senderName,
                audienceGiftTotals[senderName]
            );
            this.currentSceneData.leaderboard = mergedLeaderboard.top3;
            this.currentSceneData.userGiftRank = mergedLeaderboard.userRank;
        }
        const currentHostName = String(this.currentSceneData?.host || '').trim();
        if (currentHostName) {
            const favorabilityResult = this._applyGiftFavorabilityToFollowHost(currentHostName, text);
            if (favorabilityResult.updated) {
                this.currentSceneData.favorability = favorabilityResult.favorability;
            }
        }
        this._persistCurrentScene();
        this.render();
    }

    _resolveGiftIcon(text) {
        const raw = String(text || '');
        if (raw.includes('简介：')) return '🔔';

        const giftMatch = (Array.isArray(this.giftOptions) ? this.giftOptions : []).find((item) => {
            const name = String(item?.name || '').trim();
            const icon = String(item?.icon || '').trim();
            if (!name || !icon) return false;
            return raw.includes(name) || raw.includes(icon);
        });
        if (giftMatch?.icon) return giftMatch.icon;

        if (raw.includes('城堡')) return '🏰';
        if (raw.includes('弹幕') || raw.includes('你:') || raw.includes('你：')) return '💬';
        return '🎁';
    }

    _replaceGiftNamesWithIcons(text) {
        let result = String(text || '');
        const giftDefs = (Array.isArray(this.giftOptions) ? this.giftOptions : [])
            .map((item) => ({
                name: String(item?.name || '').trim(),
                icon: String(item?.icon || '').trim()
            }))
            .filter(item => item.name && item.icon)
            .sort((a, b) => b.name.length - a.name.length);

        giftDefs.forEach(({ name, icon }) => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escaped, 'g'), icon);
        });
        return result;
    }

    _formatGiftFeedText(text) {
        const raw = String(text || '');
        return raw
            .replace(/\s*[（(]\s*\d+\s*金币\s*[)）]\s*/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .replace(/送出\s+/g, '送出 ')
            .replace(/x\s+/gi, 'x')
            .replace(/×\s+/g, '×')
            .trim();
    }

    _isDisplayableGiftFeedLine(text) {
        const normalized = this._formatGiftFeedText(text);
        if (!normalized) return false;
        return /(?:送出|赠送|贡献|金币|金豆|[🌹🍆🍑💋🔗⛓️📿🪢🏎️🚀💎👑🍾])/u.test(normalized)
            || /打赏[^\n]{0,20}\d/u.test(normalized);
    }

    _formatGiftFeedDisplayText(text) {
        const normalized = this._formatGiftFeedText(text);
        if (!this._isDisplayableGiftFeedLine(normalized)) return '';
        return this._replaceGiftNamesWithIcons(normalized)
            .trim();
    }

    _renderGiftRewardTextHtml(text) {
        const displayText = this._formatGiftFeedDisplayText(text);
        if (!displayText) return '';

        const iconPool = (Array.isArray(this.giftOptions) ? this.giftOptions : [])
            .map((item) => String(item?.icon || '').trim())
            .filter(Boolean);
        const uniqueIcons = Array.from(new Set([...iconPool, '🎁', '💬', '🔔']));

        let matchedIcon = '';
        let matchedIndex = -1;
        uniqueIcons.forEach((icon) => {
            if (!icon) return;
            const idx = displayText.indexOf(icon);
            if (idx < 0) return;
            if (matchedIndex < 0 || idx < matchedIndex) {
                matchedIndex = idx;
                matchedIcon = icon;
            }
        });

        if (!matchedIcon || matchedIndex < 0) {
            return this._escapeHtml(displayText);
        }

        const before = displayText.slice(0, matchedIndex);
        const after = displayText.slice(matchedIndex + matchedIcon.length);
        return `${this._escapeHtml(before)}<span class="honey-gift-icon honey-gift-icon-inline">${this._escapeHtml(matchedIcon)}</span>${this._escapeHtml(after)}`;
    }

    _normalizeCommentRank(label) {
        const raw = String(label || '').trim();
        if (!raw) return '';
        const firstToken = raw.split(/[：:\s|/\\]+/)[0] || raw;
        const ranked = firstToken.match(/^(榜[一二三四五六七八九十]|榜\d+|热评|粉丝|置顶|房管|官方)$/);
        if (ranked) return ranked[1] === '粉丝' ? '热评' : ranked[1];
        const fallbackRank = raw.match(/(榜[一二三四五六七八九十]|榜\d+|热评|粉丝|置顶|房管|官方)/);
        if (fallbackRank) return fallbackRank[1] === '粉丝' ? '热评' : fallbackRank[1];
        return firstToken.slice(0, 4);
    }

    _splitLiveCommentLines(text = '') {
        return String(text || '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => String(line || '').trim())
            .filter(Boolean);
    }

    _buildLocalUserCommentLines(message = '', speakerName = '') {
        const safeSpeakerName = String(speakerName || '').replace(/\s+/g, ' ').trim() || '你';
        return this._splitLiveCommentLines(message).map(line => `${safeSpeakerName}：${line}`);
    }

    _appendUniqueParsedTickerComments(target = [], lines = []) {
        if (!Array.isArray(target) || !Array.isArray(lines)) return target;

        lines.map(line => this._parseCommentFeedLine(line))
            .filter(Boolean)
            .forEach((info) => {
                const exists = target.some((item) => {
                    const left = `${String(item?.user || '').trim()}::${String(item?.content || '').trim()}`;
                    const right = `${String(info.user || '').trim()}::${String(info.content || '').trim()}`;
                    return left && left === right;
                });
                if (!exists) {
                    target.push({
                        type: 'comment',
                        rank: info.rank,
                        user: info.user,
                        content: info.content
                    });
                }
            });

        return target;
    }

    _parseCommentFeedLine(text) {
        const raw = String(text || '').trim();
        if (!raw) return null;

        let line = raw
            .replace(/^\d{1,2}\s*[\.、]\s*/, '')
            .replace(/^[-*•]\s*/, '')
            .trim();
        if (!line) return null;

        let rank = '';
        const rankPrefix = line.match(/^(?:【\s*([^】]+)\s*】|\[\s*([^\]]+)\s*\])\s*/);
        if (rankPrefix) {
            rank = this._normalizeCommentRank(rankPrefix[1] || rankPrefix[2] || '');
            line = line.slice(rankPrefix[0].length).trim();
        }

        if (!rank) {
            const startRank = line.match(/^(榜[一二三四五六七八九十]|榜\d+|热评|粉丝|置顶|房管|官方)(?:\s+|[：:|-])*/);
            if (startRank) {
                rank = this._normalizeCommentRank(startRank[1]);
                line = line.slice(startRank[0].length).trim();
            }
        }

        let user = '';
        let content = '';
        const userSplit = line.match(/^([^\s:：，。,\.!?！？]{1,20})\s*[：:]\s*(.+)$/);
        if (userSplit) {
            user = userSplit[1].trim();
            content = userSplit[2].trim();

            // 兼容：昵称里携带身份标签，如「网友A（榜一）：...」
            const userRankMatch = user.match(/^(.*?)[（(【\[]\s*(榜[一二三四五六七八九十]|榜\d+|热评|粉丝|置顶|房管|官方)\s*[）)】\]]$/);
            if (userRankMatch) {
                const pureUser = String(userRankMatch[1] || '').trim();
                const suffixRank = this._normalizeCommentRank(userRankMatch[2] || '');
                if (pureUser) user = pureUser;
                if (!rank && suffixRank) rank = suffixRank;
            }
        } else {
            const parts = line.split(/\s+/).filter(Boolean);
            user = (parts.shift() || '').trim() || '匿名';
            content = parts.join(' ').trim() || line;
        }

        if (!rank) {
            rank = '热评';
        }

        if (content.length > 72) {
            content = `${content.slice(0, 72)}...`;
        }

        return { rank, user, content };
    }

    _simpleHash(text) {
        const input = String(text || '');
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    _resolveTopicKey(topicLike, fallbackTitle = '') {
        if (topicLike && typeof topicLike === 'object') {
            const existed = String(topicLike._topicKey || '').trim();
            if (existed) return existed;
        }
        const title = String(
            (topicLike && typeof topicLike === 'object' ? (topicLike.title || topicLike._topicTitle) : topicLike)
            || fallbackTitle
            || '直播间'
        ).trim();
        return `topic_${this._simpleHash(`${title}__0`)}`;
    }

    _resolveFollowedHostTopicKey(hostName = '') {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return '';
        return `topic_follow_${this._simpleHash(safeHostName.toLowerCase())}`;
    }

    _normalizeFollowedHostTopic(topicLike = {}, hostName = '', options = {}) {
        const safeHostName = String(hostName || topicLike?.host || '').trim();
        const topicTitle = String(
            options?.title
            || topicLike?._topicTitle
            || topicLike?.title
            || (safeHostName ? `${safeHostName} 的直播间` : '直播间')
        ).trim();
        const stableTopicKey = safeHostName ? this._resolveFollowedHostTopicKey(safeHostName) : '';
        return {
            ...(topicLike && typeof topicLike === 'object' ? topicLike : {}),
            host: safeHostName || topicLike?.host || '',
            title: topicTitle,
            _topicTitle: topicTitle,
            _topicKey: stableTopicKey || String(topicLike?._topicKey || this._resolveTopicKey(topicLike, topicTitle)).trim()
        };
    }

    _normalizeRecommendTopics(topics) {
        const source = Array.isArray(topics) ? topics : [];
        return source.map((item, idx) => {
            const safe = (item && typeof item === 'object') ? item : {};
            const title = String(safe.title || '').trim() || `推荐 ${idx + 1}`;
            const key = String(safe._topicKey || '').trim() || `topic_${this._simpleHash(`${title}__${idx}`)}`;
            return {
                ...safe,
                title,
                _topicKey: key
            };
        });
    }

    _seededShuffle(list, seed) {
        const out = Array.isArray(list) ? [...list] : [];
        let state = (seed >>> 0) || 1;
        for (let i = out.length - 1; i > 0; i--) {
            state = (state * 1664525 + 1013904223) >>> 0;
            const j = state % (i + 1);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    _resolveAvatarAssetUrl(inputPath) {
        if (typeof inputPath !== 'string') return '';
        const raw = inputPath.trim().replace(/\\/g, '/');
        if (!raw || raw.includes('..')) return '';

        if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:')) {
            return raw;
        }
        if (raw.startsWith('/')) {
            return raw;
        }

        return this._getHoneyAssetUrl(`avatars/${raw.replace(/^\.?\//, '')}`);
    }

    _normalizeAvatarList(input) {
        const source = Array.isArray(input) ? input : [];
        const out = [];
        const seen = new Set();
        for (const item of source) {
            const resolved = this._resolveAvatarAssetUrl(item);
            if (!resolved || seen.has(resolved)) continue;
            seen.add(resolved);
            out.push(resolved);
        }
        return out;
    }

    _normalizeAvatarManifest(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const hostMale = this._normalizeAvatarList([
            ...(Array.isArray(source.hostMale) ? source.hostMale : []),
            ...(Array.isArray(source.host_male) ? source.host_male : [])
        ]);
        const male = this._normalizeAvatarList(source.male);
        const female = this._normalizeAvatarList(source.female);
        const audience = this._normalizeAvatarList(source.audience);
        const all = this._normalizeAvatarList(source.all);
        return { hostMale, male, female, audience, all };
    }

    _ensureAvatarManifestLoaded() {
        if (this._avatarManifestLoaded || this._avatarManifestLoading) return;
        this._avatarManifestLoading = true;
        const manifestUrl = this._getHoneyAssetUrl('avatars/manifest.json?v=20260406-02');

        fetch(manifestUrl, { cache: 'no-cache' })
            .then(resp => (resp.ok ? resp.text() : ''))
            .then(rawText => {
                const normalizedText = String(rawText || '').replace(/^\uFEFF/, '').trim();
                if (!normalizedText) {
                    this._avatarManifest = this._normalizeAvatarManifest(null);
                    return;
                }
                let payload = null;
                try {
                    payload = JSON.parse(normalizedText);
                } catch (err) {
                    console.warn('蜜语头像 manifest 解析失败，已回退默认头像:', err);
                }
                this._avatarManifest = this._normalizeAvatarManifest(payload);
            })
            .catch(() => {
                this._avatarManifest = this._normalizeAvatarManifest(null);
            })
            .finally(() => {
                this._avatarManifestLoaded = true;
                this._avatarManifestLoading = false;
                if (this.currentPage === 'live') {
                    this.render();
                }
            });
    }

    _buildAvatarInlineStyle(url) {
        if (!url) return '';
        const safe = encodeURI(String(url)).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
        return `background-image:url('${safe}');`;
    }

    _getSillyTavernPersonaAvatar() {
        try {
            const selectedAvatarEl = document.querySelector('#user_avatar_block .avatar-container.selected img');
            if (selectedAvatarEl?.src) return selectedAvatarEl.src;

            const topBarAvatar = document.querySelector('#rm_button_panel_persona img');
            if (topBarAvatar?.src) return topBarAvatar.src;
        } catch (e) {
            console.warn('[Honey] 获取默认 Persona 头像失败:', e);
        }
        return '';
    }

    _getHoneyDisplayUserAvatar(profile = null) {
        const safeProfile = profile || this.app?.honeyData?.getHoneyUserProfile?.() || {};
        const customAvatar = String(safeProfile?.avatarUrl || '').trim();
        if (customAvatar) return customAvatar;
        return this._getSillyTavernPersonaAvatar();
    }

    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
            reader.readAsDataURL(file);
        });
    }

    _loadImageFromDataUrl(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('图片解码失败'));
            image.src = src;
        });
    }

    async _prepareHoneyReferenceImageFile(file) {
        if (!file || !String(file.type || '').startsWith('image/')) {
            throw new Error('请选择图片文件');
        }
        const maxBytes = 8 * 1024 * 1024;
        if (Number(file.size || 0) > maxBytes) {
            throw new Error('参考图最大支持 8MB');
        }

        const dataUrl = await this._readFileAsDataUrl(file);
        return await this._prepareHoneyReferenceImageDataUrl(dataUrl);
    }

    _getHoneyReferenceTargetSize(sourceWidth, sourceHeight) {
        const width = Number(sourceWidth || 0);
        const height = Number(sourceHeight || 0);
        if (!width || !height) return { width: 1024, height: 1536 };

        const ratio = width / height;
        const targetSizes = [
            { width: 1024, height: 1536 },
            { width: 1472, height: 1472 },
            { width: 1536, height: 1024 }
        ];
        return targetSizes.reduce((best, item) => {
            const bestDiff = Math.abs((best.width / best.height) - ratio);
            const itemDiff = Math.abs((item.width / item.height) - ratio);
            return itemDiff < bestDiff ? item : best;
        }, targetSizes[0]);
    }

    async _prepareHoneyReferenceImageDataUrl(dataUrl) {
        const image = await this._loadImageFromDataUrl(dataUrl);
        const sourceWidth = Number(image.naturalWidth || image.width || 0);
        const sourceHeight = Number(image.naturalHeight || image.height || 0);
        if (!sourceWidth || !sourceHeight) return dataUrl;

        const target = this._getHoneyReferenceTargetSize(sourceWidth, sourceHeight);
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
        const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
        const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
        const drawX = Math.round((canvas.width - drawWidth) / 2);
        const drawY = Math.round((canvas.height - drawHeight) / 2);
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        return canvas.toDataURL('image/png');
    }

    async _uploadHoneyReferenceImageFile(hostName, file) {
        const currentHost = this.app?.honeyData?.getFollowedHostByName?.(hostName);
        const oldReferenceImage = currentHost?.naiReferenceImage || '';
        const dataUrl = await this._prepareHoneyReferenceImageFile(file);
        const blobResp = await fetch(dataUrl);
        const blob = await blobResp.blob();
        const safeName = String(hostName || 'host')
            .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
            .slice(0, 24) || 'host';
        const uploadedUrl = await window.VirtualPhone?.imageManager?.uploadBlob?.(blob, `honey_ref_${safeName}`);
        if (!uploadedUrl) throw new Error('图片上传管理器未初始化');
        window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(oldReferenceImage, { quiet: true, skipIfReferenced: true });
        return uploadedUrl;
    }

    async _imageUrlToDataUrl(url, options = {}) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        let dataUrl = '';
        if (safeUrl.startsWith('data:image/')) {
            dataUrl = safeUrl;
        } else {
            const response = await fetch(safeUrl, {
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`参考图读取失败 (${response.status})`);
            }
            const blob = await response.blob();
            dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('参考图读取失败'));
                reader.readAsDataURL(blob);
            });
        }
        if (options?.forNaiReference) {
            return await this._prepareHoneyReferenceImageDataUrl(dataUrl);
        }
        return dataUrl;
    }

    _avatarIdentityKey(url) {
        if (!url) return '';
        let value = String(url).trim().replace(/\\/g, '/');
        if (!value) return '';
        value = value.split('#')[0].split('?')[0];
        try {
            value = decodeURIComponent(value);
        } catch (e) {
            // ignore decode errors for already-decoded or malformed URLs
        }
        const idx = value.lastIndexOf('/');
        const basename = idx >= 0 ? value.slice(idx + 1) : value;
        return basename.trim().toLowerCase();
    }

    _buildLiveAvatarSet(data, options = {}) {
        const manifest = this._avatarManifest || {};
        const seedBase = `${data?._topicKey || data?.title || 'honey'}|${data?.host || ''}|${data?.viewers || ''}`;

        const hostPool = (manifest.hostMale?.length ? manifest.hostMale : (manifest.male || []));
        const hostAvatarUrl = hostPool.length
            ? hostPool[this._simpleHash(`${seedBase}|host`) % hostPool.length]
            : '';
        const hostKey = this._avatarIdentityKey(hostAvatarUrl);

        const preferredAudienceGender = String(options?.preferredAudienceGender || '').trim().toLowerCase();
        const primaryAudiencePool = preferredAudienceGender === 'male'
            ? (manifest.male || [])
            : preferredAudienceGender === 'female'
                ? (manifest.female || [])
                : [];
        const secondaryAudiencePool = preferredAudienceGender === 'male'
            ? (manifest.female || [])
            : preferredAudienceGender === 'female'
                ? (manifest.male || [])
                : [];
        const audienceSource = primaryAudiencePool.length
            ? [
                ...primaryAudiencePool,
                ...(manifest.audience || []),
                ...secondaryAudiencePool,
                ...(manifest.all || [])
            ]
            : (manifest.audience?.length
                ? manifest.audience
                : [...(manifest.all || []), ...(manifest.male || []), ...(manifest.female || [])]);
        const audiencePool = [];
        const audienceSeen = new Set();
        for (const rawUrl of audienceSource) {
            if (!rawUrl) continue;
            const key = this._avatarIdentityKey(rawUrl) || String(rawUrl);
            if (audienceSeen.has(key)) continue;
            audienceSeen.add(key);
            audiencePool.push(rawUrl);
        }
        const filteredPool = hostKey
            ? audiencePool.filter(url => this._avatarIdentityKey(url) !== hostKey)
            : audiencePool;

        const shuffled = this._seededShuffle(filteredPool, this._simpleHash(`${seedBase}|audience`));
        const audienceAvatarUrls = shuffled.slice(0, 3);
        while (audienceAvatarUrls.length < 3) audienceAvatarUrls.push('');

        return { hostAvatarUrl, audienceAvatarUrls };
    }

    _buildLiveVideoUrl(data) {
        const hostName = String(data?.host || '').trim();
        const rawPool = this.app.honeyData?.getCustomLiveVideos?.() || [];
        const pool = [];
        const poolSeen = new Set();
        rawPool.forEach((item) => {
            const normalized = this._normalizeUploadedBackgroundUrl(item);
            if (!normalized || poolSeen.has(normalized)) return;
            poolSeen.add(normalized);
            pool.push(normalized);
        });
        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const followedHost = hostName
            ? followedHosts.find(item => this._isSameHostName(item?.name, hostName))
            : null;
        const boundVideoUrl = this._normalizeUploadedBackgroundUrl(followedHost?.boundVideoUrl || '');

        // 如果该主播绑定了专属视频，优先固定播放
        if (boundVideoUrl) {
            if (pool.length === 0 || pool.includes(boundVideoUrl)) {
                return boundVideoUrl;
            }
        }

        // 否则从用户的自定义视频池中随机抽取
        if (pool.length === 0) return '';
        const seedBase = `${data?._topicKey || data?.title || 'honey'}|${data?.host || ''}`;
        const index = this._simpleHash(seedBase) % pool.length;
        return pool[index] || '';
    }

    _buildLiveTickerFeed(data) {
        const isPrivateLive = this._isPrivateLiveScene(data);
        const gifts = (Array.isArray(data?.gifts) ? data.gifts : [])
            .map(line => this._formatGiftFeedDisplayText(line))
            .filter(Boolean)
            .map(text => ({
                type: 'gift',
                text
            }));

        const parsedComments = (Array.isArray(data?.comments) ? data.comments : [])
            .map(line => this._parseCommentFeedLine(line))
            .filter(Boolean)
            .map(info => ({
                type: 'comment',
                rank: info.rank,
                user: info.user,
                content: info.content
            }));
        const latestUserCommentText = String(data?.lastUserComment || '').trim();
        if (!isPrivateLive && latestUserCommentText) {
            this._appendUniqueParsedTickerComments(
                parsedComments,
                this._splitLiveCommentLines(latestUserCommentText)
            );
        }
        if (Array.isArray(this._livePendingDisplayLines) && this._livePendingDisplayLines.length > 0) {
            this._appendUniqueParsedTickerComments(parsedComments, this._livePendingDisplayLines);
        }
        const comments = parsedComments;

        const merged = [...gifts, ...comments];
        if (!merged.length) return [];

        // 仅打乱展示顺序，不改底层记录顺序
        const shuffleSeed = this._simpleHash(JSON.stringify(merged));
        const shuffled = this._seededShuffle(merged, shuffleSeed);
        return shuffled;
    }

    _renderGiftPickerHtml() {
        const lowGifts = this.giftOptions
            .filter(g => g.price <= 100)
            .sort((a, b) => a.price - b.price);
        const highGifts = this.giftOptions
            .filter(g => g.price > 100)
            .sort((a, b) => a.price - b.price);

        const renderGiftBtn = (g) => `
            <button class="honey-gift-option" data-gift="${g.name}">
                <span class="gift-emoji">${g.icon}</span>
                <span class="gift-label">${g.name}</span>
                <span class="gift-price">${g.price}金币</span>
            </button>
        `;

        return `
            <div class="honey-gift-group-title">低价礼物</div>
            ${lowGifts.map(renderGiftBtn).join('')}
            <div class="honey-gift-group-title">高价礼物</div>
            ${highGifts.map(renderGiftBtn).join('')}
        `;
    }

    _escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _sanitizeLiveRoomTitle(rawTitle) {
        const text = String(rawTitle || '').trim();
        if (!text) return '直播间';
        return text.replace(/^\s*(?:AI|ＡＩ)\s*(?=直播间)/i, '').trim() || '直播间';
    }

    _getLiveTickerIntro(data) {
        const intro = String(data?.intro || '').trim();
        if (!intro) return '';

        // 空值/占位值/错误状态不展示在简介滚动条里
        if (/^(暂无|无|none)$/i.test(intro)) return '';
        if (/正在连线|获取失败|点击刷新/.test(intro)) return '';
        if (/\[主播性癖|性格|线下价格|联播收费/.test(intro)) return '';

        return intro;
    }

    _syncTopTitleMarquee() {
        const root = document.querySelector('.phone-view-current .honey-page-live') || document.querySelector('.honey-page-live');
        if (!root) return;
        const wrap = root.querySelector('#honey-ui-title-top-wrap');
        const track = root.querySelector('#honey-ui-title-top-track');
        const text = root.querySelector('#honey-ui-title-top');
        const clone = root.querySelector('#honey-ui-title-top-clone');
        if (!wrap || !track || !text || !clone) return;

        wrap.classList.remove('is-marquee');
        clone.textContent = '';
        clone.style.removeProperty('margin-left');
        track.style.removeProperty('animation');
        track.style.removeProperty('transform');
        track.style.removeProperty('--honey-title-cycle-distance');
        track.style.removeProperty('--honey-title-marquee-duration');

        requestAnimationFrame(() => {
            const overflow = text.scrollWidth - wrap.clientWidth;
            if (overflow > 8) {
                const gap = 26;
                const cycleDistance = text.scrollWidth + gap;
                const duration = Math.max(6.5, cycleDistance / 24);
                clone.textContent = text.textContent;
                clone.style.marginLeft = `${gap}px`;
                track.style.setProperty('--honey-title-cycle-distance', `${cycleDistance}px`);
                track.style.setProperty('--honey-title-marquee-duration', `${duration.toFixed(2)}s`);
                wrap.classList.add('is-marquee');
            }
        });
    }

    _syncIntroTicker() {
        const root = document.querySelector('.phone-view-current .honey-page-live') || document.querySelector('.honey-page-live');
        if (!root) return;
        const wrap = root.querySelector('#honey-intro-ticker-wrap');
        const track = root.querySelector('#honey-intro-ticker-track');
        const text = root.querySelector('#honey-intro-ticker-text');
        const clone = root.querySelector('#honey-intro-ticker-clone');
        if (!wrap || !track || !text || !clone) return;

        track.classList.remove('marquee');
        clone.textContent = '';
        clone.style.removeProperty('margin-left');
        track.style.removeProperty('animation');
        track.style.removeProperty('transform');
        track.style.removeProperty('--honey-intro-marquee-distance');
        track.style.removeProperty('--honey-intro-marquee-duration');

        requestAnimationFrame(() => {
            const overflow = text.scrollWidth - wrap.clientWidth;
            if (overflow > 8) {
                const gap = 28;
                const distance = text.scrollWidth + gap;
                const duration = Math.max(14, distance / 18);
                clone.textContent = text.textContent;
                clone.style.marginLeft = `${gap}px`;
                track.style.setProperty('--honey-intro-marquee-distance', `${distance}px`);
                track.style.setProperty('--honey-intro-marquee-duration', `${duration.toFixed(2)}s`);
                track.classList.add('marquee');
            }
        });
    }

    _getPromptManager() {
        const promptManager = window.VirtualPhone?.promptManager;
        if (promptManager && !promptManager._loaded) {
            promptManager.ensureLoaded();
        }
        return promptManager;
    }

    _getHoneyPromptConfig(promptManager = null) {
        const manager = promptManager || this._getPromptManager();
        let prompt = manager?.prompts?.honey?.live;
        if (!prompt) {
            const defaults = manager?.getDefaultPrompts?.();
            const defaultPrompt = defaults?.honey?.live;
            if (defaultPrompt) {
                prompt = { ...defaultPrompt };
            }
        }
        return prompt || {
            name: '蜜语直播/视频',
            description: '蜜语APP直播与视频生成规则',
            content: ''
        };
    }

    _getHoneyOverridePromptConfig(promptManager = null) {
        const manager = promptManager || this._getPromptManager();
        let prompt = manager?.prompts?.honey?.override;
        if (!prompt) {
            const defaults = manager?.getDefaultPrompts?.();
            const defaultPrompt = defaults?.honey?.override;
            if (defaultPrompt) {
                prompt = { ...defaultPrompt };
            }
        }
        return prompt || {
            name: '蜜语破限词',
            description: '蜜语看直播和自己开播请求开头注入',
            content: ''
        };
    }

    _getHoneyUserLivePromptConfig(promptManager = null) {
        const manager = promptManager || this._getPromptManager();
        let prompt = manager?.prompts?.honey?.userLive;
        if (!prompt) {
            const defaults = manager?.getDefaultPrompts?.();
            const defaultPrompt = defaults?.honey?.userLive;
            if (defaultPrompt) {
                prompt = { ...defaultPrompt };
            }
        }
        return prompt || {
            name: '蜜语用户开播',
            description: '用户自己开播时的 JSON 输出规则',
            content: ''
        };
    }

    _isHoneyLiveEnabled(promptManager = null) {
        // 蜜语改为按用户主动触发，不再受设置页开关阻断
        return true;
    }

    _hasMeaningfulSceneDescription(desc) {
        const text = String(desc || '').trim();
        if (!text) return false;
        if (text === '点击刷新后由 AI 生成实时剧情。') return false;
        if (text === '点击左侧刷新按钮生成剧情。') return false;
        if (text === '回推荐页下拉刷新生成剧情。') return false;
        if (text === this._getUserLiveIdleHintText()) return false;
        if (text === '暂无剧情描写。') return false;
        if (text === '暂无剧情描写，点击刷新后自动生成。') return false;
        if (text === '正在根据主题生成直播内容...') return false;
        if (text === '正在连线中...') return false;
        if (text === 'AI 正在根据你的弹幕继续推进直播剧情...') return false;
        return true;
    }

    _hasMeaningfulAiComments(comments = []) {
        if (!Array.isArray(comments) || comments.length === 0) return false;
        const lines = comments
            .map(line => String(line || '').trim())
            .filter(Boolean);
        if (lines.length === 0) return false;
        return lines.some(line => !/^系统公告[:：]\s*连线成功，剧情已刷新。?$/i.test(line));
    }

    _hasEffectiveAiSceneUpdate(aiData, currentScene = null) {
        if (!aiData || typeof aiData !== 'object') return false;

        const aiDescription = String(aiData.description || '').trim();
        const aiHost = String(aiData.host || '').trim();
        const aiTitle = String(aiData.title || '').trim();
        const aiIntro = String(aiData.intro || '').trim();
        const aiComments = Array.isArray(aiData.comments) ? aiData.comments : [];
        const aiGifts = Array.isArray(aiData.gifts) ? aiData.gifts : [];
        const aiLeaderboard = Array.isArray(aiData.leaderboard) ? aiData.leaderboard : [];
        const aiFriendRequests = Array.isArray(aiData.friendRequests) ? aiData.friendRequests : [];
        const aiCollabRequests = Array.isArray(aiData.collabRequests) ? aiData.collabRequests : [];
        const aiFavorability = this._normalizeFavorability(aiData.favorability, null);
        const aiNaiPrompt = this._resolveSceneNaiPrompt(aiData);
        const currentNaiPrompt = this._resolveSceneNaiPrompt(currentScene);
        const hasNaiPromptDelta = !!aiNaiPrompt && aiNaiPrompt !== currentNaiPrompt;

        const currentDescription = String(currentScene?.description || '').trim();
        const hasMeaningfulDescription = this._hasMeaningfulSceneDescription(aiDescription)
            && aiDescription !== currentDescription;

        const currentComments = Array.isArray(currentScene?.comments) ? currentScene.comments : [];
        const aiCommentsKey = aiComments.map(line => String(line || '').trim()).filter(Boolean).join('\n');
        const currentCommentsKey = currentComments.map(line => String(line || '').trim()).filter(Boolean).join('\n');
        const hasMeaningfulComments = this._hasMeaningfulAiComments(aiComments)
            && aiCommentsKey !== currentCommentsKey;
        const hasGifts = aiGifts.length > 0;
        const hasLeaderboard = aiLeaderboard.length > 0;
        const hasFriendRequests = aiFriendRequests.length > 0;
        const hasCollabRequests = aiCollabRequests.length > 0;
        const hasFavorability = aiFavorability !== null;

        const hasMetaDelta = ['viewers', 'playCount', 'fans', 'collab'].some((key) => {
            const nextVal = String(aiData?.[key] || '').trim();
            if (!nextVal) return false;
            if (key !== 'collab' && /^(?:0|0人|0在线|0\s*online)$/i.test(nextVal)) return false;
            const prevVal = String(currentScene?.[key] || '').trim();
            return nextVal !== prevVal;
        });

        const hasHostOrTitleDelta = (aiHost && aiHost !== '神秘主播' && aiHost !== String(currentScene?.host || '').trim())
            || (aiTitle && aiTitle !== '激情直播中...' && aiTitle !== String(currentScene?.title || '').trim());
        const hasIntroDelta = !!aiIntro && aiIntro !== String(currentScene?.intro || '').trim();

        return hasMeaningfulDescription
            || hasMeaningfulComments
            || hasGifts
            || hasLeaderboard
            || hasFriendRequests
            || hasCollabRequests
            || hasFavorability
            || hasNaiPromptDelta
            || hasMetaDelta
            || hasHostOrTitleDelta
            || hasIntroDelta;
    }

    _isHoneyAutoImageEnabled() {
        const raw = this.app?.storage?.get?.('phone-image-honey-auto-generate');
        return raw === true || raw === 'true';
    }

    _deleteManagedHoneyGeneratedImage(url = '') {
        const safeUrl = String(url || '').trim();
        if (!safeUrl || !this._isManagedBackgroundUrl(safeUrl)) return;
        window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(safeUrl, { quiet: true });
    }

    _resolveHoneyHostWechatContact(hostName = '') {
        const safeHostName = String(hostName || '').trim();
        if (!safeHostName) return null;
        try {
            const wechatData = window.VirtualPhone?.wechatApp?.wechatData || window.VirtualPhone?.cachedWechatData;
            const contacts = wechatData?.getContacts?.() || [];
            if (!Array.isArray(contacts) || contacts.length === 0) return null;
            return contacts.find(contact => wechatData._isSameLookupName?.(contact?.name, safeHostName))
                || contacts.find(contact => String(contact?.name || '').trim() === safeHostName)
                || null;
        } catch (e) {
            return null;
        }
    }

    _buildHoneyImagePromptWithWechatContactTags(hostName = '', prompt = '') {
        const basePrompt = String(prompt || '').trim();
        const contact = this._resolveHoneyHostWechatContact(hostName);
        const contactTags = String(contact?.naiPromptTags || contact?.imageTags || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .join(', ');
        if (!contactTags) return basePrompt;
        if (!basePrompt) return contactTags;
        return `${contactTags}, ${basePrompt}`;
    }

    async _generateSceneImageFromPrompt({ scene = null, prompt = '', auto = false, sourceRoot = null } = {}) {
        const normalizedPrompt = String(prompt || '').trim();
        const baseScene = scene || this.currentSceneData || {};
        if (!normalizedPrompt) {
            if (!auto) this.app?.phoneShell?.showNotification?.('蜜语', '当前直播没有可用的 NAI 提示词', '⚠️');
            return null;
        }

        const imageManager = window.VirtualPhone?.imageGenerationManager;
        if (!imageManager || typeof imageManager.generate !== 'function') {
            if (!auto) this.app?.phoneShell?.showNotification?.('生图失败', '生图管理器未初始化', '❌');
            return null;
        }

        const imageStorage = this.app?.storage || window.VirtualPhone?.storage || null;
        if (imageStorage && imageManager.storage !== imageStorage) {
            imageManager.storage = imageStorage;
        }
        const readNumber = (key, fallback, min, max, integer = true) => {
            const raw = imageStorage?.get?.(key);
            const value = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
            let next = Number.isFinite(value) ? value : fallback;
            next = Math.max(min, Math.min(max, next));
            return integer ? Math.round(next) : next;
        };
        const provider = String(imageManager.resolveProvider?.({ app: 'honey' }) || imageStorage?.get?.('phone-image-provider') || 'novelai').trim() || 'novelai';
        let honeyWidth = readNumber('phone-image-honey-width', 832, 64, 2048, true);
        let honeyHeight = readNumber('phone-image-honey-height', 1216, 64, 2048, true);
        if (honeyWidth <= 64 && honeyHeight <= 64) {
            honeyWidth = 832;
            honeyHeight = 1216;
        }
        const imageSteps = readNumber('phone-image-steps', 28, 1, 50, true);
        const imageScale = readNumber('phone-image-scale', 7, 0, 50, false);
        const globalSeed = readNumber('phone-image-seed', -1, -1, 4294967295, true);
        const requestSeed = Number.isFinite(globalSeed) && globalSeed >= 0 ? Math.floor(globalSeed) : -1;
        const seedLogText = requestSeed >= 0 ? String(requestSeed) : '随机（Seed=-1）';
        const promptPreview = typeof imageManager.previewFinalPrompt === 'function'
            ? imageManager.previewFinalPrompt({
                app: 'honey',
                prompt: normalizedPrompt,
                width: honeyWidth,
                height: honeyHeight,
                steps: imageSteps,
                scale: imageScale,
                seed: requestSeed
            })
            : null;
        const sceneHostName = String(baseScene?.host || this.currentSceneData?.host || '').trim();
        const generationPrompt = this._buildHoneyImagePromptWithWechatContactTags(sceneHostName, normalizedPrompt);
        const generationPromptPreview = generationPrompt !== normalizedPrompt && typeof imageManager.previewFinalPrompt === 'function'
            ? imageManager.previewFinalPrompt({
                app: 'honey',
                prompt: generationPrompt,
                width: honeyWidth,
                height: honeyHeight,
                steps: imageSteps,
                scale: imageScale,
                seed: requestSeed
            })
            : promptPreview;
        const hostNaiReference = ['novelai', 'sd'].includes(provider)
            ? this.app?.honeyData?.getHostNaiReference?.(sceneHostName)
            : null;
        let novelAIReferences = [];
        if (hostNaiReference?.image) {
            try {
                const referenceImageDataUrl = await this._imageUrlToDataUrl(hostNaiReference.image, { forNaiReference: true });
                if (referenceImageDataUrl) {
                    novelAIReferences = [{
                        ...hostNaiReference,
                        image: referenceImageDataUrl
                    }];
                }
            } catch (err) {
                console.warn('[Honey NAI] 角色参考图读取失败，已跳过:', err);
                if (!auto) {
                    this.app?.phoneShell?.showNotification?.('蜜语', '角色参考图读取失败，本次将不使用参考图', '⚠️');
                }
            }
        }

        console.log([
            auto ? '[Honey NAI] 自动请求直播生图' : '[Honey NAI] 即将请求直播生图',
            `尺寸: ${honeyWidth}x${honeyHeight}`,
            `Steps: ${imageSteps}`,
            `Scale: ${imageScale}`,
            `Provider: ${provider}`,
            `Seed: ${seedLogText}`,
            `主播参考图: ${novelAIReferences.length ? `${sceneHostName || '未知主播'} · 已启用` : '未使用'}`,
            '',
            'AI 原始画面 tag:',
            normalizedPrompt || '(空)',
            ...(generationPrompt !== normalizedPrompt ? [
                '',
                '微信好友专属生图Tag已拼接后的实际画面 tag:',
                generationPrompt || '(空)'
            ] : []),
            '',
            '固定前置提示词:',
            generationPromptPreview?.fixedPrompt || '(空)',
            '',
            '固定后置提示词:',
            generationPromptPreview?.fixedPromptEnd || '(空)',
            '',
            '最终正向提示词:',
            generationPromptPreview?.positivePrompt || generationPrompt || '(空)',
            '',
            '最终负面提示词:',
            generationPromptPreview?.negativePrompt || '(空)'
        ].join('\n'));

        this.currentSceneData = {
            ...(this.currentSceneData || baseScene),
            ...baseScene,
            naiPrompt: normalizedPrompt,
            naiImageUrl: '',
            generatedImageUrl: '',
            imageUrl: '',
            imageGenerationStatus: 'loading',
            imageGenerationProvider: provider,
            imageGenerationModel: '',
            imageGenerationPrompt: normalizedPrompt,
            imageGenerationWidth: '',
            imageGenerationHeight: '',
            imageGenerationSteps: '',
            imageGenerationSampler: '',
            imageGenerationSchedule: '',
            imageGenerationScale: '',
            imageGenerationError: ''
        };
        this._persistCurrentScene();
        this._refreshHoneyImageGenerationView(sourceRoot);

        try {
            const result = await imageManager.generate({
                app: 'honey',
                prompt: generationPrompt,
                width: honeyWidth,
                height: honeyHeight,
                steps: imageSteps,
                scale: imageScale,
                seed: requestSeed,
                novelAIReferences
            });
            const rawImageUrl = String(result.imageUrl || result.imageData || '').trim();
            const previousManagedImageUrl = String(baseScene?.naiImageUrl || baseScene?.generatedImageUrl || baseScene?.imageUrl || '').trim();
            const persistedImageUrl = rawImageUrl.startsWith('data:image/')
                ? await this._uploadHoneyGeneratedImageDataUrl(rawImageUrl, {
                    hostName: sceneHostName,
                    seed: result.seed ?? requestSeed,
                    oldImageUrl: previousManagedImageUrl
                })
                : rawImageUrl;
            if (!persistedImageUrl) throw new Error('生图成功但未返回可保存的图片');
            if (!rawImageUrl.startsWith('data:image/')
                && previousManagedImageUrl
                && previousManagedImageUrl !== persistedImageUrl
                && this._isManagedBackgroundUrl(previousManagedImageUrl)) {
                window.VirtualPhone?.imageManager?.deleteManagedBackgroundByPath?.(previousManagedImageUrl, { quiet: true });
            }
            this.currentSceneData = {
                ...(this.currentSceneData || baseScene),
                naiImageUrl: persistedImageUrl,
                generatedImageUrl: persistedImageUrl,
                imageUrl: persistedImageUrl,
                naiPrompt: normalizedPrompt,
                imageGenerationStatus: 'done',
                imageGenerationProvider: result.provider || provider,
                imageGenerationModel: result.model || '',
                imageGenerationPrompt: normalizedPrompt,
                imageGenerationWidth: Number(result.width || result.requestedWidth || 0) || '',
                imageGenerationHeight: Number(result.height || result.requestedHeight || 0) || '',
                imageGenerationSteps: Number(result.steps || 0) || '',
                imageGenerationSeed: Number(result.seed ?? requestSeed),
                imageGenerationSampler: String(result.sampler || '').trim(),
                imageGenerationSchedule: String(result.schedule || '').trim(),
                imageGenerationScale: Number(result.scale || 0) || '',
                imageGenerationError: ''
            };
            this._persistCurrentScene();
            this._refreshHoneyImageGenerationView(sourceRoot);
            this.app?.phoneShell?.showNotification?.('蜜语', auto ? '新剧情图片已自动生成' : '直播图片已生成', '🖼️');
            return result;
        } catch (err) {
            const message = err?.message || String(err || '生成失败');
            this.currentSceneData = {
                ...(this.currentSceneData || baseScene),
                naiPrompt: normalizedPrompt,
                naiImageUrl: '',
                generatedImageUrl: '',
                imageUrl: '',
                imageGenerationStatus: 'failed',
                imageGenerationProvider: provider,
                imageGenerationPrompt: normalizedPrompt,
                imageGenerationError: message
            };
            this._persistCurrentScene();
            const didRefreshHoneyView = this._refreshHoneyImageGenerationView(sourceRoot);
            this.app?.phoneShell?.showNotification?.(auto ? '自动生图失败' : '生图失败', message, '❌');
            if (didRefreshHoneyView) {
                this._showHoneyImageErrorModal(message, { title: auto ? '自动生图失败' : '生图失败' });
            }
            return null;
        }
    }

    _restoreSessionState() {
        this.recommendTopics = this._getDefaultTopics();
        this.currentSceneData = null;
        this.selectedTopic = null;
        this._liveBackTarget = 'home';

        const state = this.app?.honeyData?.loadSessionState?.();
        if (!state) return;

        if (Array.isArray(state.recommendTopics) && state.recommendTopics.length > 0) {
            this.recommendTopics = this._normalizeRecommendTopics(state.recommendTopics);
        }

        if (state.currentSceneData && typeof state.currentSceneData === 'object') {
            const sceneTitle = String(state.currentSceneData._topicTitle || state.currentSceneData.title || '').trim();
            this.currentSceneData = {
                ...state.currentSceneData,
                _topicTitle: sceneTitle || '直播间',
                _topicKey: this._resolveTopicKey(state.currentSceneData, sceneTitle)
            };
        }

        const selectedKey = String(state.selectedTopicKey || this.currentSceneData?._topicKey || '').trim();
        const selectedTitle = String(state.selectedTopicTitle || this.currentSceneData?._topicTitle || '').trim();
        if (selectedKey || selectedTitle) {
            this.selectedTopic = this.recommendTopics.find(t => String(t?._topicKey || '').trim() === selectedKey)
                || this.recommendTopics.find(t => String(t?.title || '').trim() === selectedTitle)
                || {
                ...this._getFallbackTopic(),
                title: selectedTitle || this._getFallbackTopic().title,
                _topicKey: selectedKey || this._resolveTopicKey(selectedTitle)
            };
        }

        if (this.currentSceneData && this.selectedTopic) {
            this.currentSceneData._topicKey = this.currentSceneData._topicKey || this._resolveTopicKey(this.selectedTopic, this.selectedTopic.title);
            this.currentSceneData._topicTitle = this.currentSceneData._topicTitle || this.selectedTopic.title;
            if (!this._hasMeaningfulSceneDescription(this.currentSceneData.description)
                && this._hasMeaningfulSceneDescription(this.selectedTopic.description)) {
                this.currentSceneData.description = this.selectedTopic.description;
            }
            if ((!Array.isArray(this.currentSceneData.comments) || this.currentSceneData.comments.length === 0)
                && Array.isArray(this.selectedTopic.comments) && this.selectedTopic.comments.length > 0) {
                this.currentSceneData.comments = this.selectedTopic.comments;
            }
        }

        if (this._isUserLiveScene(this.selectedTopic || this.currentSceneData)) {
            this._liveBackTarget = 'mine';
            this._liveEntrySource = 'mine';
        }
    }

    _getSessionKey() {
        const context = this.app?.storage?.getContext?.() || null;
        const charId = context?.characterId || context?.name2 || 'default_char';
        const chatId = context?.chatMetadata?.file_name || context?.chatId || 'default_chat';
        return `${charId}::${chatId}`;
    }

    _syncSessionState(force = false) {
        const key = this._getSessionKey();
        if (!force && key === this._sessionKey) return;
        this._sessionKey = key;
        this.isScenePanelOpen = false;
        this._isSceneTagHistoryOpen = false;
        this._restoreSessionState();
        if (this.currentPage === 'live' && !this.currentSceneData) {
            this.currentPage = 'recommend';
        }
    }

    _getActiveTopicTitle() {
        const activeLiveScene = (this.currentPage === 'live' && this.currentSceneData && typeof this.currentSceneData === 'object')
            ? this.currentSceneData
            : null;
        return String(
            activeLiveScene?._topicTitle
            || activeLiveScene?.title
            || this.selectedTopic?.title
            || this.currentSceneData?._topicTitle
            || this.currentSceneData?.title
            || this.recommendTopics?.[0]?.title
            || this._getFallbackTopic().title
        ).trim();
    }

    _getActiveTopicKey() {
        const activeLiveScene = (this.currentPage === 'live' && this.currentSceneData && typeof this.currentSceneData === 'object')
            ? this.currentSceneData
            : null;
        return String(
            activeLiveScene?._topicKey
            || this.selectedTopic?._topicKey
            || this.currentSceneData?._topicKey
            || this._resolveTopicKey(activeLiveScene || this.selectedTopic || this.currentSceneData || this.recommendTopics?.[0] || this._getFallbackTopic(), this._getActiveTopicTitle())
        ).trim();
    }

    _isActiveLiveTopic(topicKey = '', topicTitle = '') {
        if (this.currentPage !== 'live') return false;
        const safeKey = String(topicKey || '').trim();
        const safeTitle = String(topicTitle || '').trim();
        const activeKey = this._getActiveTopicKey();
        const activeTitle = this._getActiveTopicTitle();
        return (!!safeKey && activeKey === safeKey)
            || (!safeKey && !!safeTitle && activeTitle === safeTitle)
            || (!!safeTitle && activeTitle === safeTitle && !activeKey);
    }

    _resolveSceneNaiPrompt(sceneLike) {
        const scene = sceneLike || {};
        const direct = String(
            scene.naiPrompt
            || scene.imageGenerationPrompt
            || scene.imagePrompt
            || scene.novelaiPrompt
            || ''
        ).trim();
        if (direct) return direct;

        const sourceText = [
            scene.picture,
            scene.visual,
            scene.screen,
            scene.frame,
            scene.description,
            scene.intro
        ].map(item => String(item || '').trim()).filter(Boolean).join('\n');
        return this.app?.honeyData?._extractNaiPrompt?.(sourceText) || '';
    }

    _buildBaseScene(topicLike, topicTitle, topicKey = '') {
        const source = topicLike || this._getFallbackTopic();
        const safeTitle = String(topicTitle || source._topicTitle || source.title || '直播间').trim();
        const safeKey = String(topicKey || source._topicKey || this._resolveTopicKey(source, safeTitle)).trim();
        const safeCollabCost = Math.max(0, Number.parseInt(String(source.collabCost ?? 0), 10) || 0);
        const safeAudienceGiftTotals = this._getSceneAudienceGiftTotals(source);
        const safeTag = String(source.tag || source.category || source.recommendCategory || source.heat || '').trim();
        const safeCategory = String(source.category || source.recommendCategory || source.tag || '').trim();
        const safeUserGiftRank = (source?.userGiftRank && typeof source.userGiftRank === 'object')
            ? {
                rank: Math.max(1, Number.parseInt(String(source.userGiftRank.rank || 0), 10) || 1),
                name: this._normalizeLeaderboardName(source.userGiftRank.name || ''),
                coins: String(source.userGiftRank.coins || '').trim()
            }
            : null;
        const safeCollabRequests = this._normalizeLiveCollabRequests(source?.collabRequests || []);
        const safeCollabRequestInfo = this._normalizeLiveCollabRequest(source?.collabRequestInfo || null);
        return {
            host: source.host || '神秘主播',
            title: source.title || safeTitle || '直播间',
            tag: safeTag,
            category: safeCategory,
            recommendCategory: String(source.recommendCategory || source.category || source.tag || '').trim(),
            viewers: source.viewers || '0',
            playCount: source.playCount || '0',
            fans: source.fans || '0',
            collab: source.collab || '无',
            collabCost: safeCollabCost,
            intro: source.intro || '',
            naiPrompt: this._resolveSceneNaiPrompt(source),
            imageGenerationPrompt: String(source.imageGenerationPrompt || '').trim(),
            naiImageUrl: String(source.naiImageUrl || '').trim(),
            generatedImageUrl: String(source.generatedImageUrl || source.imageUrl || '').trim(),
            imageGenerationStatus: String(source.imageGenerationStatus || '').trim(),
            imageGenerationProvider: String(source.imageGenerationProvider || '').trim(),
            imageGenerationModel: String(source.imageGenerationModel || '').trim(),
            imageGenerationWidth: Number(source.imageGenerationWidth || 0) || '',
            imageGenerationHeight: Number(source.imageGenerationHeight || 0) || '',
            imageGenerationSteps: Number(source.imageGenerationSteps || 0) || '',
            imageGenerationSampler: String(source.imageGenerationSampler || '').trim(),
            imageGenerationSchedule: String(source.imageGenerationSchedule || '').trim(),
            imageGenerationScale: Number(source.imageGenerationScale || 0) || '',
            imageGenerationError: String(source.imageGenerationError || '').trim(),
            description: source.description || this._getRecommendRefreshHintText(),
            comments: Array.isArray(source.comments) ? source.comments : [],
            lastUserComment: String(source.lastUserComment || '').trim(),
            userChats: Array.isArray(source.userChats) ? source.userChats : [],
            promptTurns: Array.isArray(source.promptTurns) ? source.promptTurns : [],
            naiTagHistory: this._getSceneNaiTagHistory(source),
            gifts: Array.isArray(source.gifts) ? source.gifts : [],
            leaderboard: Array.isArray(source.leaderboard) ? source.leaderboard : [],
            audienceGiftTotals: safeAudienceGiftTotals,
            userGiftRank: (safeUserGiftRank && safeUserGiftRank.name) ? safeUserGiftRank : null,
            collabRequests: safeCollabRequests,
            collabRequestInfo: safeCollabRequestInfo,
            favorability: this._normalizeFavorability(source.favorability ?? source.affection, 0),
            visibility: String(source.visibility || '').trim() === 'private' || source.isPrivateLive === true ? 'private' : 'public',
            isPrivateLive: String(source.visibility || '').trim() === 'private' || source.isPrivateLive === true,
            _topicTitle: safeTitle,
            _topicKey: safeKey
        };
    }

    _isPrivateLiveScene(scene = null) {
        const source = scene && typeof scene === 'object'
            ? scene
            : (this.currentSceneData || this.selectedTopic || null);
        return String(source?.visibility || '').trim() === 'private' || source?.isPrivateLive === true;
    }

    _isPrivateUserLiveScene(scene = null) {
        const source = scene && typeof scene === 'object'
            ? scene
            : (this.currentSceneData || this.selectedTopic || null);
        return this._isUserLiveScene(source) && this._isPrivateLiveScene(source);
    }

    _buildLiveVisibilityModalHtml() {
        if (!this._liveVisibilityModalOpen) return '';
        return `
            <div class="honey-live-visibility-modal" id="honey-live-visibility-modal">
                <button class="honey-live-visibility-backdrop" type="button" data-action="close-live-visibility" aria-label="关闭"></button>
                <div class="honey-live-visibility-panel" role="dialog" aria-modal="true" aria-label="选择直播模式">
                    <div class="honey-live-visibility-title">选择直播模式</div>
                    <div class="honey-live-visibility-desc">公开直播会正常显示评论区；私密直播会进入【私密中】，直播间不要求回复评论区。</div>
                    <div class="honey-live-visibility-actions">
                        <button class="honey-live-visibility-btn is-private" type="button" data-action="start-private-live">
                            <i class="fa-solid fa-lock"></i>
                            <span>私密</span>
                        </button>
                        <button class="honey-live-visibility-btn is-public" type="button" data-action="start-public-live">
                            <i class="fa-solid fa-eye"></i>
                            <span>公开</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    _persistCurrentScene() {
        if (!this.currentSceneData) return;
        const topicTitle = this._getActiveTopicTitle();
        const topicKey = this._getActiveTopicKey();
        const scene = {
            ...this.currentSceneData,
            _topicTitle: topicTitle,
            _topicKey: topicKey
        };
        this.app?.honeyData?.saveTopicScene?.(topicKey || topicTitle, scene, topicTitle);
        this.app?.honeyData?.saveLastSceneData?.(scene);
        this.app?.honeyData?.saveSelectedTopicTitle?.(topicTitle);
        this.app?.honeyData?.saveSelectedTopicKey?.(topicKey);

        if (Array.isArray(this.recommendTopics) && this.recommendTopics.length > 0) {
            const idx = this.recommendTopics.findIndex(t => {
                const itemKey = String(t?._topicKey || '').trim();
                const itemTitle = String(t?.title || '').trim();
                return (topicKey && itemKey && itemKey === topicKey) || itemTitle === topicTitle;
            });
            if (idx >= 0) {
                this.recommendTopics[idx] = {
                    ...this.recommendTopics[idx],
                    _topicKey: this.recommendTopics[idx]._topicKey || topicKey,
                    _topicTitle: scene._topicTitle || topicTitle,
                    title: scene.title || this.recommendTopics[idx].title,
                    tag: scene.tag || this.recommendTopics[idx].tag,
                    category: scene.category || this.recommendTopics[idx].category,
                    recommendCategory: scene.recommendCategory || this.recommendTopics[idx].recommendCategory,
                    host: scene.host || this.recommendTopics[idx].host,
                    viewers: scene.viewers || this.recommendTopics[idx].viewers,
                    playCount: scene.playCount || this.recommendTopics[idx].playCount,
                    fans: scene.fans || this.recommendTopics[idx].fans,
                    collab: scene.collab || this.recommendTopics[idx].collab,
                    collabCost: scene.collabCost ?? this.recommendTopics[idx].collabCost,
                    intro: scene.intro || this.recommendTopics[idx].intro,
                    naiPrompt: scene.naiPrompt || this.recommendTopics[idx].naiPrompt,
                    imageGenerationPrompt: scene.imageGenerationPrompt || this.recommendTopics[idx].imageGenerationPrompt,
                    naiImageUrl: scene.naiImageUrl || this.recommendTopics[idx].naiImageUrl,
                    generatedImageUrl: scene.generatedImageUrl || this.recommendTopics[idx].generatedImageUrl,
                    imageUrl: scene.imageUrl || this.recommendTopics[idx].imageUrl,
                    imageGenerationStatus: scene.imageGenerationStatus || this.recommendTopics[idx].imageGenerationStatus,
                    imageGenerationProvider: scene.imageGenerationProvider || this.recommendTopics[idx].imageGenerationProvider,
                    imageGenerationModel: scene.imageGenerationModel || this.recommendTopics[idx].imageGenerationModel,
                    imageGenerationWidth: scene.imageGenerationWidth || this.recommendTopics[idx].imageGenerationWidth,
                    imageGenerationHeight: scene.imageGenerationHeight || this.recommendTopics[idx].imageGenerationHeight,
                    imageGenerationSteps: scene.imageGenerationSteps || this.recommendTopics[idx].imageGenerationSteps,
                    imageGenerationSeed: scene.imageGenerationSeed || this.recommendTopics[idx].imageGenerationSeed,
                    imageGenerationSampler: scene.imageGenerationSampler || this.recommendTopics[idx].imageGenerationSampler,
                    imageGenerationSchedule: scene.imageGenerationSchedule || this.recommendTopics[idx].imageGenerationSchedule,
                    imageGenerationScale: scene.imageGenerationScale || this.recommendTopics[idx].imageGenerationScale,
                    imageGenerationError: scene.imageGenerationError || this.recommendTopics[idx].imageGenerationError,
                    description: scene.description || this.recommendTopics[idx].description,
                    comments: Array.isArray(scene.comments) ? scene.comments : this.recommendTopics[idx].comments,
                    lastUserComment: scene.lastUserComment || this.recommendTopics[idx].lastUserComment,
                    userChats: Array.isArray(scene.userChats) ? scene.userChats : this.recommendTopics[idx].userChats,
                    promptTurns: Array.isArray(scene.promptTurns) ? scene.promptTurns : this.recommendTopics[idx].promptTurns,
                    naiTagHistory: Array.isArray(scene.naiTagHistory) ? scene.naiTagHistory : this.recommendTopics[idx].naiTagHistory,
                    gifts: Array.isArray(scene.gifts) ? scene.gifts : this.recommendTopics[idx].gifts,
                    leaderboard: Array.isArray(scene.leaderboard) ? scene.leaderboard : this.recommendTopics[idx].leaderboard,
                    audienceGiftTotals: scene.audienceGiftTotals && typeof scene.audienceGiftTotals === 'object'
                        ? scene.audienceGiftTotals
                        : this.recommendTopics[idx].audienceGiftTotals,
                    userGiftRank: scene.userGiftRank && typeof scene.userGiftRank === 'object'
                        ? scene.userGiftRank
                        : this.recommendTopics[idx].userGiftRank,
                    collabRequests: Array.isArray(scene.collabRequests) ? scene.collabRequests : this.recommendTopics[idx].collabRequests,
                    collabRequestInfo: scene.collabRequestInfo && typeof scene.collabRequestInfo === 'object'
                        ? scene.collabRequestInfo
                        : this.recommendTopics[idx].collabRequestInfo,
                    favorability: scene.favorability ?? this.recommendTopics[idx].favorability,
                    isUserLive: scene.isUserLive === true || this.recommendTopics[idx].isUserLive === true
                };
                this.recommendTopics = this._normalizeRecommendTopics(this.recommendTopics);
                this.app?.honeyData?.saveRecommendTopics?.(this.recommendTopics);
            }
        }

        const sceneHostName = String(scene.host || '').trim();
        if (!sceneHostName) return;
        const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
        const matchedFollowedHost = followedHosts.find(item => this._isSameHostName(item?.name, sceneHostName));
        if (!matchedFollowedHost) return;
        const persistedHostName = String(matchedFollowedHost?.name || sceneHostName).trim();
        if (!persistedHostName) return;

        this.app?.honeyData?.updateFollowedHost?.(persistedHostName, {
            liveTitle: String(scene?.title || '').trim(),
            intro: String(scene?.intro || '').trim(),
            fans: String(scene?.fans || '').trim()
        });
        const sceneDate = this._getCurrentStoryDateOrSystem();
        this.app?.honeyData?.markHostActive?.(persistedHostName, Date.now());
        this.app?.honeyData?.saveHostHistory?.(persistedHostName, sceneDate, scene);
    }

    async _generateCurrentTopicScene({ resetSession = false, notify = false, forceTopicTitle = '', forceTopicKey = '', sourceRoot = null, userMessage = '', suppressRecommendListUpdate = false } = {}) {
        const topicTitle = String(forceTopicTitle || this._getActiveTopicTitle()).trim();
        const topicKey = String(forceTopicKey || this._getActiveTopicKey()).trim();
        const normalizedUserMessage = String(userMessage || '').trim();
        if (!topicTitle) return;
        if (!this._isHoneyLiveEnabled()) {
            throw new Error('蜜语功能已关闭，请在设置中开启后再生成。');
        }
        const pendingToken = topicKey || topicTitle;
        if (this._isGeneratingScene && this._pendingGenerateTopic === pendingToken) return;
        this._isGeneratingScene = true;
        this._pendingGenerateTopic = pendingToken;

        try {
            const isRequestStillActive = () => {
                return this._isActiveLiveTopic(topicKey, topicTitle);
            };

            let workingScene = this.app?.honeyData?.getTopicScene?.(topicKey || topicTitle, topicTitle);
            if (!workingScene || typeof workingScene !== 'object') {
                workingScene = this._buildBaseScene(this.selectedTopic || this._getFallbackTopic(), topicTitle, topicKey);
            } else {
                workingScene = {
                    ...workingScene,
                    _topicTitle: topicTitle,
                    _topicKey: topicKey || this._resolveTopicKey(workingScene, topicTitle)
                };
            }

            const sceneSnapshotBeforeRequest = JSON.parse(JSON.stringify(workingScene || {}));
            this._storeLiveTurnRetrySnapshot({
                topicTitle,
                topicKey,
                userMessage: normalizedUserMessage,
                sceneSnapshot: sceneSnapshotBeforeRequest,
                resetSession
            });
            const restoreSceneSnapshot = () => {
                const restoredScene = {
                    ...sceneSnapshotBeforeRequest,
                    _topicTitle: topicTitle,
                    _topicKey: topicKey || this._resolveTopicKey(sceneSnapshotBeforeRequest, topicTitle)
                };
                this.app?.honeyData?.saveTopicScene?.(topicKey || topicTitle, restoredScene, topicTitle);
                if (isRequestStillActive()) {
                    this.currentSceneData = restoredScene;
                    this.selectedTopic = {
                        ...(this.selectedTopic || {}),
                        title: topicTitle,
                        _topicKey: topicKey,
                        host: restoredScene.host,
                        viewers: restoredScene.viewers,
                    fans: restoredScene.fans,
                    collab: restoredScene.collab,
                    intro: restoredScene.intro,
                    naiPrompt: restoredScene.naiPrompt,
                    imageGenerationPrompt: restoredScene.imageGenerationPrompt,
                    naiImageUrl: restoredScene.naiImageUrl,
                    generatedImageUrl: restoredScene.generatedImageUrl,
                    imageGenerationStatus: restoredScene.imageGenerationStatus,
                    imageGenerationProvider: restoredScene.imageGenerationProvider,
                    imageGenerationModel: restoredScene.imageGenerationModel,
                    imageGenerationWidth: restoredScene.imageGenerationWidth,
                    imageGenerationHeight: restoredScene.imageGenerationHeight,
                    imageGenerationSteps: restoredScene.imageGenerationSteps,
                    imageGenerationSampler: restoredScene.imageGenerationSampler,
                    imageGenerationSchedule: restoredScene.imageGenerationSchedule,
                    imageGenerationScale: restoredScene.imageGenerationScale,
                    description: restoredScene.description,
                    comments: restoredScene.comments
                };
                    this._persistCurrentScene();
                    if (this.currentPage === 'live') {
                        this._refreshLivePageDom({ sourceRoot, scene: restoredScene });
                    }
                }
            };

            if (resetSession) {
                this.app?.honeyData?.clearTopicScene?.(topicKey || topicTitle, {
                    clearLastSceneIfMatch: true,
                    fallbackTitle: topicTitle,
                    topicKey
                });
                workingScene = this._buildBaseScene(this.selectedTopic || this._getFallbackTopic(), topicTitle, topicKey);
                workingScene.title = topicTitle;
                workingScene.comments = [];
                workingScene.userChats = [];
                workingScene.promptTurns = [];
                workingScene.gifts = [];
                workingScene.lastUserComment = '';

                const snapshotHostName = String(sceneSnapshotBeforeRequest?.host || '').trim();
                const followedHosts = this.app?.honeyData?.getFollowedHosts?.() || [];
                const isSnapshotHostFollowed = followedHosts.some(item => this._isSameHostName(item?.name, snapshotHostName));
                if (isSnapshotHostFollowed) {
                    workingScene.audienceGiftTotals = this._getSceneAudienceGiftTotals(sceneSnapshotBeforeRequest);
                    const honeyNickname = this.app?.honeyData?.getHoneyUserNickname?.() || '你';
                    const safeNick = this._normalizeLeaderboardName(honeyNickname);
                    const userGiftTotal = Math.max(0, Math.round(Number(workingScene.audienceGiftTotals?.[safeNick] || 0)));
                    const mergedLeaderboard = this._buildMergedLeaderboardWithUser(sceneSnapshotBeforeRequest?.leaderboard, honeyNickname, userGiftTotal);
                    workingScene.leaderboard = mergedLeaderboard.top3;
                    workingScene.userGiftRank = mergedLeaderboard.userRank;
                }
            }

            const previousDescription = String(workingScene?.description || '').trim();
            const previousUserChats = Array.isArray(workingScene?.userChats) ? workingScene.userChats : [];
            const previousPromptTurns = Array.isArray(workingScene?.promptTurns) ? workingScene.promptTurns : [];
            const previousComments = Array.isArray(workingScene?.comments) ? workingScene.comments : [];
            const previousGiftsForRequestMode = Array.isArray(workingScene?.gifts) ? workingScene.gifts : [];
            const previousLastUserComment = String(workingScene?.lastUserComment || '').trim();
            const isUserLiveTopic = this._isUserLiveScene({ ...workingScene, _topicKey: topicKey, _topicTitle: topicTitle });
            const honeyNickname = this.app?.honeyData?.getHoneyUserNickname?.() || '你';
            const userLiveProfile = isUserLiveTopic
                ? (this.app?.honeyData?.getHoneyUserProfile?.() || {})
                : null;
            const userLiveSpeakerName = String(userLiveProfile?.nickname || honeyNickname || '你').trim() || '你';
            const localUserCommentLines = normalizedUserMessage
                ? this._buildLocalUserCommentLines(
                    normalizedUserMessage,
                    isUserLiveTopic ? userLiveSpeakerName : honeyNickname
                )
                : [];
            const localUserComment = localUserCommentLines.join('\n');
            if (normalizedUserMessage) {
                workingScene.userChats = [...previousUserChats, ...localUserCommentLines].slice(-200);
                workingScene.comments = [];
                workingScene.lastUserComment = localUserComment;
                workingScene.description = 'AI 正在根据你的弹幕继续推进直播剧情...';
            } else {
                workingScene.userChats = previousUserChats.slice(-200);
                workingScene.comments = [];
                workingScene.lastUserComment = previousLastUserComment;
                workingScene.description = '正在连线中...';
            }

            const sceneEl = sourceRoot?.querySelector?.('#honey-ui-scene-modal')
                || sourceRoot?.querySelector?.('#honey-ui-scene');
            if (sceneEl && isRequestStillActive()) {
                sceneEl.textContent = normalizedUserMessage
                    ? 'AI 正在根据你的弹幕继续推进直播剧情...'
                    : '正在连线中...';
            }

            if (isRequestStillActive()) {
                this.currentSceneData = { ...workingScene, _topicTitle: topicTitle, _topicKey: topicKey };
                this._persistCurrentScene();
                if (this.currentPage === 'live') {
                    this._refreshLivePageDom({ sourceRoot, scene: this.currentSceneData });
                }
            } else {
                this.app?.honeyData?.saveTopicScene?.(topicKey || topicTitle, {
                    ...workingScene,
                    _topicTitle: topicTitle,
                    _topicKey: topicKey
                }, topicTitle);
            }

            const hasRecommendTopic = Array.isArray(this.recommendTopics) && this.recommendTopics.some(t => {
                const itemKey = String(t?._topicKey || '').trim();
                const itemTitle = String(t?.title || '').trim();
                return (topicKey && itemKey === topicKey) || (!!topicTitle && itemTitle === topicTitle);
            });
            const isDirectLiveTopic = topicKey === 'topic_direct_live';
            const hasExistingLiveState = this._hasMeaningfulSceneDescription(previousDescription)
                || previousComments.length > 0
                || previousUserChats.length > 0
                || previousGiftsForRequestMode.length > 0
                || this._getSceneAudienceGiftTotals(workingScene) && Object.keys(this._getSceneAudienceGiftTotals(workingScene)).length > 0;
            const requestMode = isUserLiveTopic
                ? (normalizedUserMessage
                    ? (hasExistingLiveState ? 'continue' : 'start_with_user_message')
                    : 'idle')
                : (normalizedUserMessage
                    ? 'continue'
                    : ((isDirectLiveTopic || !hasRecommendTopic) ? 'from_scratch' : 'recommend'));
            const requestTopic = (requestMode === 'recommend' || requestMode === 'continue')
                ? topicTitle
                : '';

            let aiData = null;
            try {
                aiData = await (isUserLiveTopic
                    ? this.app.honeyData.generateUserLiveScene(null, {
                        requestMode,
                        userMessage: normalizedUserMessage,
                        previousDescription,
                        currentUserChats: previousUserChats,
                        promptTurns: previousPromptTurns,
                        currentScene: workingScene,
                        currentComments: previousComments,
                        visibility: workingScene?.visibility || this.currentSceneData?.visibility || this.selectedTopic?.visibility || 'public',
                        isPrivateLive: this._isPrivateUserLiveScene(workingScene || this.currentSceneData || this.selectedTopic)
                    })
                    : this.app.honeyData.generateLiveScene(null, {
                    requestMode,
                    topic: requestTopic,
                    userMessage: normalizedUserMessage,
                    previousDescription,
                    currentUserChats: previousUserChats,
                    promptTurns: previousPromptTurns,
                    currentScene: workingScene,
                    currentComments: previousComments,
                    visibility: workingScene?.visibility || this.currentSceneData?.visibility || this.selectedTopic?.visibility || 'public',
                    isPrivateLive: this._isPrivateLiveScene(workingScene || this.currentSceneData || this.selectedTopic)
                }));
            } catch (err) {
                const errMsg = String(err?.message || err || '').trim();
                const isEmptyLikeError = /返回为空|empty|null|无内容|空响应|未返回有效内容/i.test(errMsg);
                if (isEmptyLikeError) {
                    restoreSceneSnapshot();
                    if (isRequestStillActive()) {
                        this.app?.phoneShell?.showNotification?.('蜜语', 'AI未返回有效更新，已保留当前内容', 'ℹ️');
                    }
                    return;
                }
                restoreSceneSnapshot();
                throw err;
            }

            if (isUserLiveTopic && aiData && typeof aiData === 'object') {
                aiData = {
                    ...aiData,
                    leaderboard: [],
                    userGiftRank: null
                };
            }

            const mergedFriendRequests = this.app?.honeyData?.mergeHoneyFriendRequests?.(aiData?.friendRequests || [])
                || { added: 0, list: this.app?.honeyData?.getHoneyFriendRequests?.() || [] };
            const mergedInteractionRecords = isUserLiveTopic
                ? (this.app?.honeyData?.applyHoneyInteractionRecords?.(aiData?.interactionRecords || []) || { updatedFriends: 0, updatedRequests: 0, updatedContacts: 0 })
                : { updatedFriends: 0, updatedRequests: 0, updatedContacts: 0 };
            const previousCollabRequests = this._normalizeLiveCollabRequests(workingScene?.collabRequests || []);
            const aiCollabRequests = isUserLiveTopic
                ? this._normalizeLiveCollabRequests(aiData?.collabRequests || [])
                : [];
            const aiDataForEffectCheck = mergedFriendRequests.added > 0
                ? aiData
                : { ...aiData, friendRequests: [] };

            if (!this._hasEffectiveAiSceneUpdate(aiDataForEffectCheck, sceneSnapshotBeforeRequest)) {
                restoreSceneSnapshot();
                if (isRequestStillActive()) {
                    this.app?.phoneShell?.showNotification?.('蜜语', 'AI未返回有效更新，已保留当前内容', 'ℹ️');
                }
                return;
            }

            // 核心修复：只有在 "from_scratch" 且允许覆盖时，才更新推荐列表
            // 直播页内的局部刷新会显式传 suppressRecommendListUpdate=true，避免误刷新推荐池。
            if (!isUserLiveTopic && requestMode === 'from_scratch' && !suppressRecommendListUpdate) {
                if (Array.isArray(aiData?.recommendTopics) && aiData.recommendTopics.length > 0) {
                    this.recommendTopics = this._normalizeRecommendTopics(aiData.recommendTopics);
                    this.app?.honeyData?.saveRecommendTopics?.(this.recommendTopics);
                }
            } else if (!isUserLiveTopic && requestMode === 'from_scratch' && suppressRecommendListUpdate) {
                console.log('️ [蜜语防覆盖] 直播页局部刷新已拦截 AI 附带推荐列表更新。');
            } else if (!isUserLiveTopic) {
                console.log(`️ [蜜语防覆盖] 当前模式为 ${requestMode}，已拦截并丢弃 AI 附带生成的推荐列表，保护原有推荐页。`);
            }

            const previousGifts = resetSession ? [] : (Array.isArray(workingScene?.gifts) ? workingScene.gifts : []);
            const aiGifts = Array.isArray(aiData?.gifts) ? aiData.gifts : [];
            const mergedGifts = [...previousGifts, ...aiGifts]
                .filter(line => this._isDisplayableGiftFeedLine(line))
                .slice(-8);
            const aiComments = Array.isArray(aiData?.comments) ? aiData.comments : [];
            const aiHasOnlyFallbackComment = aiComments.length === 1 && /系统公告[:：]/.test(String(aiComments[0] || ''));
            const useAiComments = aiComments.length > 0 && !(normalizedUserMessage && aiHasOnlyFallbackComment);
            let mergedComments = useAiComments ? aiComments : [];
            if (this._isPrivateLiveScene(workingScene || this.currentSceneData || this.selectedTopic)) {
                mergedComments = [];
            }
            const nextLastUserComment = localUserComment || previousLastUserComment;
            const aiDescription = String(aiData?.description || '').trim();
            const nextDescription = this._hasMeaningfulSceneDescription(aiDescription)
                ? aiDescription
                : (normalizedUserMessage ? '' : previousDescription);

            const resolvedSceneHostName = String(aiData?.host || workingScene?.host || '').trim();
            const aiParsedFavorability = this._normalizeFavorability(aiData?.favorability, null);
            const resolvedFollowFavorability = this._resolveFollowFavorabilityAfterAi(
                resolvedSceneHostName,
                aiData?.favorability,
                normalizedUserMessage
            );
            const fallbackSceneFavorability = this._normalizeFavorability(
                workingScene?.favorability ?? workingScene?.affection,
                null
            );
            const resolvedSceneFavorability = resolvedFollowFavorability ?? aiParsedFavorability ?? fallbackSceneFavorability;

            const baseScene = this._buildBaseScene(this.selectedTopic || workingScene || this._getFallbackTopic(), topicTitle, topicKey);
            const nextScene = {
                ...baseScene,
                ...workingScene,
                ...aiData,
                isUserLive: isUserLiveTopic || aiData?.isUserLive === true,
                friendRequests: mergedFriendRequests.list,
                gifts: mergedGifts,
                comments: mergedComments,
                description: nextDescription || workingScene.description || '',
                lastUserComment: nextLastUserComment,
                visibility: workingScene?.visibility || this.currentSceneData?.visibility || this.selectedTopic?.visibility || 'public',
                isPrivateLive: this._isPrivateLiveScene(workingScene || this.currentSceneData || this.selectedTopic),
                _topicTitle: topicTitle,
                _topicKey: topicKey
            };
            const previousNaiPrompt = this._resolveSceneNaiPrompt(workingScene);
            const nextNaiPrompt = this._resolveSceneNaiPrompt(nextScene);
            const hasNewNaiPrompt = !!nextNaiPrompt && nextNaiPrompt !== previousNaiPrompt;
            if (nextNaiPrompt) {
                nextScene.naiPrompt = nextNaiPrompt;
                nextScene.imageGenerationPrompt = '';
            }
            nextScene.naiTagHistory = this._appendSceneNaiTagHistoryForTopic(
                this._getSceneNaiTagHistory(workingScene),
                nextNaiPrompt,
                {
                    source: hasNewNaiPrompt ? 'ai_new' : 'ai_same',
                    topicKey,
                    topicTitle
                }
            );
            const previousGeneratedImageUrls = [
                workingScene?.naiImageUrl,
                workingScene?.generatedImageUrl,
                workingScene?.imageUrl
            ].map(item => String(item || '').trim()).filter(Boolean);
            nextScene.naiImageUrl = '';
            nextScene.generatedImageUrl = '';
            nextScene.imageUrl = '';
            nextScene.imageGenerationStatus = '';
            nextScene.imageGenerationProvider = '';
            nextScene.imageGenerationModel = '';
            nextScene.imageGenerationWidth = '';
            nextScene.imageGenerationHeight = '';
            nextScene.imageGenerationSteps = '';
            nextScene.imageGenerationSampler = '';
            nextScene.imageGenerationSchedule = '';
            nextScene.imageGenerationScale = '';
            nextScene.imageGenerationError = '';
            const previousIntro = String(workingScene?.intro || '').trim();
            if (!String(nextScene?.intro || '').trim() && previousIntro) {
                nextScene.intro = previousIntro;
            }
            ['tag', 'category', 'recommendCategory'].forEach((key) => {
                const nextValue = String(nextScene?.[key] || '').trim();
                const previousValue = String(workingScene?.[key] || baseScene?.[key] || '').trim();
                if (!nextValue && previousValue) {
                    nextScene[key] = previousValue;
                }
            });
            const mergedAudienceGiftTotals = {
                ...this._getSceneAudienceGiftTotals(workingScene),
                ...this._getSceneAudienceGiftTotals(nextScene)
            };
            if (isUserLiveTopic) {
                const effectiveCollabName = this._normalizeLiveCollabName(nextScene?.collab);
                const mergedCollabRequests = effectiveCollabName === '无'
                    ? this._mergeLiveCollabRequests(previousCollabRequests, aiCollabRequests)
                    : [];
                const previousCollabInfo = this._normalizeLiveCollabRequest(workingScene?.collabRequestInfo || null);
                const matchedAcceptedRequest = this._mergeLiveCollabRequests(previousCollabRequests, aiCollabRequests)
                    .find(item => this._normalizeLeaderboardName(item?.name || '') === this._normalizeLeaderboardName(effectiveCollabName));

                const userLiveExcludedNames = [
                    userLiveSpeakerName,
                    userLiveProfile?.nickname || '',
                    '你',
                    'user'
                ];
                const updatedAudienceGiftTotals = this._accumulateAudienceGiftTotalsFromGiftLines(
                    mergedAudienceGiftTotals,
                    aiGifts,
                    { excludeNames: userLiveExcludedNames }
                );
                const userLiveLeaderboardState = this._buildLeaderboardFromAudienceTotals(updatedAudienceGiftTotals);
                nextScene.audienceGiftTotals = updatedAudienceGiftTotals;
                nextScene.leaderboard = userLiveLeaderboardState.top3;
                nextScene.userGiftRank = null;
                nextScene.collabRequests = mergedCollabRequests;
                nextScene.collabRequestInfo = effectiveCollabName !== '无'
                    ? (matchedAcceptedRequest || previousCollabInfo || null)
                    : null;

                const resolvedCollabState = effectiveCollabName;
                if (resolvedCollabState === '无' && !String(aiData?.description || '').trim()) {
                    nextScene.description = '当前暂无联播剧情，直播主要通过弹幕滚动推进。';
                }
            } else {
                const updatedAudienceGiftTotals = this._accumulateAudienceGiftTotalsFromGiftLines(
                    mergedAudienceGiftTotals,
                    aiGifts
                );
                nextScene.audienceGiftTotals = updatedAudienceGiftTotals;
                const honeyNicknameForRank = this.app?.honeyData?.getHoneyUserNickname?.() || '你';
                const safeHoneyNickname = this._normalizeLeaderboardName(honeyNicknameForRank);
                const userGiftTotal = Math.max(0, Math.round(Number(updatedAudienceGiftTotals[safeHoneyNickname] || 0)));
                const mergedLeaderboardState = this._buildMergedLeaderboardWithUser(nextScene?.leaderboard, honeyNicknameForRank, userGiftTotal);
                nextScene.leaderboard = mergedLeaderboardState.top3;
                nextScene.userGiftRank = mergedLeaderboardState.userRank;
            }
            if (resolvedSceneFavorability !== null) {
                nextScene.favorability = resolvedSceneFavorability;
            }

            const previousCollabRequestFingerprint = this._getLiveCollabRequestFingerprint(previousCollabRequests);
            const nextCollabRequestFingerprint = this._getLiveCollabRequestFingerprint(nextScene?.collabRequests || []);
            const hasNewCollabRequests = !!nextCollabRequestFingerprint && nextCollabRequestFingerprint !== previousCollabRequestFingerprint;

            this.app?.honeyData?.saveTopicScene?.(topicKey || topicTitle, nextScene, topicTitle);
            [...new Set(previousGeneratedImageUrls)].forEach(url => this._deleteManagedHoneyGeneratedImage(url));

            if (isRequestStillActive()) {
                this.currentSceneData = nextScene;
                this.selectedTopic = {
                    ...(this.selectedTopic || {}),
                    title: topicTitle,
                    _topicKey: topicKey,
                    tag: this.currentSceneData.tag,
                    category: this.currentSceneData.category,
                    recommendCategory: this.currentSceneData.recommendCategory,
                    host: this.currentSceneData.host,
                    viewers: this.currentSceneData.viewers,
                    fans: this.currentSceneData.fans,
                    collab: this.currentSceneData.collab,
                    intro: this.currentSceneData.intro,
                    naiPrompt: this.currentSceneData.naiPrompt,
                    imageGenerationPrompt: this.currentSceneData.imageGenerationPrompt,
                    naiImageUrl: this.currentSceneData.naiImageUrl,
                    generatedImageUrl: this.currentSceneData.generatedImageUrl,
                    imageGenerationStatus: this.currentSceneData.imageGenerationStatus,
                    imageGenerationProvider: this.currentSceneData.imageGenerationProvider,
                    imageGenerationModel: this.currentSceneData.imageGenerationModel,
                    imageGenerationWidth: this.currentSceneData.imageGenerationWidth,
                    imageGenerationHeight: this.currentSceneData.imageGenerationHeight,
                    imageGenerationSteps: this.currentSceneData.imageGenerationSteps,
                    imageGenerationSampler: this.currentSceneData.imageGenerationSampler,
                    imageGenerationSchedule: this.currentSceneData.imageGenerationSchedule,
                    imageGenerationScale: this.currentSceneData.imageGenerationScale,
                    description: this.currentSceneData.description,
                    comments: this.currentSceneData.comments
                };

                if (hasNewCollabRequests) {
                    this._dismissedLiveCollabRequestFingerprint = '';
                }
                this._persistCurrentScene();
                if (this.currentPage === 'live') {
                    this._refreshLivePageDom({ sourceRoot, scene: nextScene });
                }
                if (hasNewNaiPrompt && this._isHoneyAutoImageEnabled()) {
                    this._generateSceneImageFromPrompt({
                        scene: this.currentSceneData,
                        prompt: nextNaiPrompt,
                        auto: true,
                        sourceRoot
                    });
                }
            }

            if (notify && isRequestStillActive()) {
                this.app.phoneShell.showNotification('蜜语', '直播剧情已刷新', '✅');
            }
            if (mergedFriendRequests.added > 0 && isRequestStillActive()) {
                this.app?.phoneShell?.showNotification?.('蜜语', `新增 ${mergedFriendRequests.added} 条好友申请`, '💌');
            }
            if (isUserLiveTopic && hasNewCollabRequests && isRequestStillActive() && this._normalizeLiveCollabName(this.currentSceneData?.collab) === '无') {
                this.app?.phoneShell?.showNotification?.('联播通知', `收到 ${aiCollabRequests.length} 条新的联播申请`, '📡');
            }
        } finally {
            this._isGeneratingScene = false;
            this._pendingGenerateTopic = '';
            this._syncLiveStatusDot(sourceRoot);
        }
    }

    _getFallbackTopic() {
        return {
            title: '直播间',
            heat: '',
            tag: '',
            category: '',
            recommendCategory: '',
            host: '神秘主播',
            viewers: '0',
            playCount: '0',
            fans: '0',
            collab: '无',
            intro: '',
            comments: [],
            lastUserComment: '',
            userChats: [],
            promptTurns: [],
            audienceGiftTotals: {},
            userGiftRank: null,
            collabRequests: [],
            collabRequestInfo: null,
            description: this._getRecommendRefreshHintText()
        };
    }

    _getDirectLiveTopic() {
        return {
            ...this._getFallbackTopic(),
            title: '直播间',
            _topicKey: 'topic_direct_live'
        };
    }

    _getUserLiveTopic(profile = null) {
        const safeProfile = (profile && typeof profile === 'object')
            ? profile
            : (this.app?.honeyData?.getHoneyUserProfile?.() || {});
        const nickname = String(safeProfile?.nickname || '主播').trim() || '主播';
        const liveTitle = String(safeProfile?.liveTitle || `${nickname}的直播间`).trim() || `${nickname}的直播间`;
        const followerCount = Math.max(0, Number.parseInt(String(safeProfile?.followers || 0), 10) || 0);
        return {
            ...this._getFallbackTopic(),
            title: liveTitle,
            host: nickname,
            fans: String(followerCount),
            viewers: '0',
            playCount: '0',
            intro: String(safeProfile?.intro || '').trim(),
            isUserLive: true,
            _topicKey: 'topic_user_live'
        };
    }

    _syncUserLiveProfileDisplay(profile = null, patch = {}) {
        const safeProfile = (profile && typeof profile === 'object')
            ? profile
            : (this.app?.honeyData?.getHoneyUserProfile?.() || null);
        if (!safeProfile) return;

        const hasTitlePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'liveTitle');
        const hasIntroPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'intro');
        const hasAvatarPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'avatarUrl');
        const hasFollowerPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'followers');
        const hasNicknamePatch = Object.prototype.hasOwnProperty.call(patch || {}, 'nickname');
        const hasGenderPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'gender');
        if (!hasTitlePatch && !hasIntroPatch && !hasAvatarPatch && !hasFollowerPatch && !hasNicknamePatch && !hasGenderPatch) return;

        const syncedTopic = this._getUserLiveTopic(safeProfile);
        const activeSource = this.currentSceneData || this.selectedTopic;
        const shouldSyncActiveScene = this._isUserLiveScene(activeSource);

        if (this.selectedTopic && this._isUserLiveScene(this.selectedTopic)) {
            this.selectedTopic = {
                ...this.selectedTopic,
                title: syncedTopic.title,
                host: syncedTopic.host,
                intro: syncedTopic.intro,
                fans: hasFollowerPatch ? syncedTopic.fans : (this.selectedTopic.fans || syncedTopic.fans),
                _topicKey: 'topic_user_live'
            };
            this.app?.honeyData?.saveSelectedTopicTitle?.(this.selectedTopic.title);
            this.app?.honeyData?.saveSelectedTopicKey?.('topic_user_live');
        }

        if (this.currentSceneData && shouldSyncActiveScene) {
            this.currentSceneData = {
                ...this.currentSceneData,
                title: syncedTopic.title,
                _topicTitle: syncedTopic.title,
                host: syncedTopic.host,
                intro: syncedTopic.intro,
                fans: hasFollowerPatch ? syncedTopic.fans : (this.currentSceneData.fans || syncedTopic.fans)
            };
            const topicRef = this.currentSceneData._topicKey || this.currentSceneData._topicTitle || 'topic_user_live';
            this.app?.honeyData?.saveTopicScene?.(topicRef, this.currentSceneData, syncedTopic.title);
            this._persistCurrentScene();
        }
    }

    _isUserLiveScene(scene = null) {
        const source = scene && typeof scene === 'object'
            ? scene
            : (this.currentSceneData || this.selectedTopic || null);
        const topicKey = String(source?._topicKey || '').trim();
        if (topicKey === 'topic_user_live') return true;
        if (source?.isUserLive === true) return true;
        return false;
    }

    _getDefaultTopics() {
        return [];
    }

    _cleanupTransient() {
        clearTimeout(this._recommendRefreshTimer);
        this._recommendRefreshTimer = null;
        clearTimeout(this._liveRefreshTimer);
        this._liveRefreshTimer = null;
        if (this._liveBatchTimer) {
            clearTimeout(this._liveBatchTimer);
            this._liveBatchTimer = null;
        }
        if (this._liveViewportCleanup) {
            this._liveViewportCleanup();
            this._liveViewportCleanup = null;
        }
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
    }

    _pauseHoneyVideos() {
        document.querySelectorAll('.honey-page-live #honey-live-video-el, .honey-page-recommend #honey-bg-video-el').forEach(video => {
            video.pause?.();
        });
    }

    _stopHoneyAnimations() {
        document.querySelectorAll('.honey-live-gifts-list.is-scrolling').forEach(el => {
            el.classList.remove('is-scrolling');
        });
        document.querySelectorAll('.honey-live-gifts-track').forEach(el => {
            el.style.animation = 'none';
            el.style.transform = 'translate3d(0, 0, 0)';
        });
        document.querySelectorAll('.honey-live-gift-text-track.marquee').forEach(el => {
            el.classList.remove('marquee');
            el.style.animation = 'none';
            el.style.transform = 'translate3d(0, 0, 0)';
            el.style.removeProperty('--honey-intro-marquee-distance');
            el.style.removeProperty('--honey-intro-marquee-duration');
        });
        document.querySelectorAll('.honey-meta-title.is-marquee').forEach(el => {
            el.classList.remove('is-marquee');
        });
        document.querySelectorAll('.honey-meta-title-track').forEach(el => {
            el.style.animation = 'none';
            el.style.transform = 'translate3d(0, 0, 0)';
            el.style.removeProperty('--honey-title-cycle-distance');
            el.style.removeProperty('--honey-title-marquee-duration');
        });
    }

    releaseInactiveResources() {
        this._cleanupTransient();
        this._pauseHoneyVideos();
        this._stopHoneyAnimations();
        this._stopHoneyTtsPlayback();
        this._clearHoneyTtsCache();
        this._livePendingUserLines = [];
        this._livePendingDisplayLines = [];
        this._liveSendInFlight = false;
    }

    _applyPhoneChromeTheme() {
        document.querySelectorAll('.phone-body-panel-honey').forEach(el => el.classList.remove('phone-body-panel-honey'));
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.add('phone-body-panel-honey');
    }

    removePhoneChromeTheme() {
        this.releaseInactiveResources();
        const panel = document.querySelector('.phone-body-panel');
        panel?.classList.remove('phone-body-panel-honey');
    }
}
