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
// 🎵 音乐APP - 数据层
// ========================================

export class MusicData {
    constructor(storage) {
        this.storage = storage;
        this.audioPlayer = new Audio();
        this._playlist = null;     // lazy load，存储键 music_playlist
        this._favorites = null;    // 收藏夹列表
        this._favoritesGlobalKey = 'global_music_favorites'; // 全局共享（跨会话）
        this._favoritesLegacyChatKey = 'music_favorites';    // 旧版：按会话存储
        this.activeListType = 'playlist'; // 当前激活的播放列表 ('playlist' 待播清单 或 'favorites' 收藏夹)
        this.currentIndex = -1;
        this.isPlaying = false;
        this._cardData = null;     // 最新一楼的 <Music> 解析数据
        this.onStateChange = null; // UI更新回调
        this._failedSongs = new Set(); // 获取失败的歌曲，防止无限重试
        this._playLock = false;    // 防止并发播放请求
        this._playGeneration = 0;  // 播放请求代次，用于取消过期请求
        this._userPaused = false;  // 记录用户是否手动按了暂停
        this._prefetching = new Set(); // 预取中的歌曲，避免重复请求

        // 音频事件绑定
        this.audioPlayer.addEventListener('ended', () => this._onTrackEnded());
        this.audioPlayer.addEventListener('error', (e) => {
            console.warn('🎵 [音乐] 播放出错:', e);
            this.isPlaying = false;
            this._playLock = false;

            // 【新增】判断是否为媒体资源加载错误
            const error = this.audioPlayer.error;
            if (error && error.code === error.MEDIA_ERR_SRC_NOT_SUPPORTED) { // MEDIA_ERR_SRC_NOT_SUPPORTED 通常对应403/404
                console.log(`🎵 [音乐] 检测到链接失效，尝试自动修复: ${this.getCurrentSong()?.name}`);
                // 调用新的修复函数
                this._recoverAndPlay(this.currentIndex);
            } else {
                this._notifyStateChange();
            }
        });
    }

    // ========== 歌单管理 ==========

    getPlaylist() {
        if (this._playlist === null) {
            const saved = this.storage.get('music_playlist', null);
            if (saved) {
                try {
                    this._playlist = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    this._playlist = [];
                }
            } else {
                this._playlist = [];
            }
        }
        return this._playlist;
    }

    savePlaylist() {
        this.storage.set('music_playlist', JSON.stringify(this._playlist || []));
    }

    // ========== 收藏夹管理 ==========
    getFavorites() {
        if (this._favorites === null) {
            // 1) 优先读取全局收藏（跨会话共享）
            let saved = this.storage.get(this._favoritesGlobalKey, null);

            // 2) 兼容旧版：若全局为空，回退读取旧会话收藏并迁移到全局
            if (!saved) {
                saved = this.storage.get(this._favoritesLegacyChatKey, null);
                if (saved) {
                    this.storage.set(this._favoritesGlobalKey, saved);
                }
            }

            if (saved) {
                try { this._favorites = typeof saved === 'string' ? JSON.parse(saved) : saved; }
                catch (e) { this._favorites = []; }
            } else {
                this._favorites = [];
            }
        }
        return this._favorites;
    }

    saveFavorites() {
        this.storage.set(this._favoritesGlobalKey, JSON.stringify(this._favorites || []));
    }

    toggleFavorite(song) {
        const favs = this.getFavorites();
        const index = favs.findIndex(s => s.name === song.name && s.artist === song.artist);
        if (index > -1) {
            favs.splice(index, 1);
        } else {
            favs.push({ ...song });
        }
        this.saveFavorites();
        this._notifyStateChange();
    }

    isFavorite(song) {
        return this.getFavorites().some(s => s.name === song.name && s.artist === song.artist);
    }

    getActiveList() {
        return this.activeListType === 'favorites' ? this.getFavorites() : this.getPlaylist();
    }

    addSong(name, artist) {
        const playlist = this.getPlaylist();

        // 去重
        const exists = playlist.some(s => s.name === name && s.artist === artist);
        if (exists) return;

        playlist.push({ name, artist, url: null, pic: null, lrc: null });
        this.savePlaylist();

        // 🔥 修复核心：新歌加入时，绝不允许打断当前正在播放的歌曲！
        // 只有当：目前完全没在播放、没在加载、开启了连播、悬浮窗在、且用户没有主动按过暂停，才自动播放新歌
        const isFloatingEnabled = this.storage.get('music_show_floating', false);
        
        // 只有当前什么声音都没有的时候，才允许触发自动播放
        if (!this.isPlaying && !this._playLock && this.getAutoPlay() && isFloatingEnabled && !this._userPaused) {
            // 如果连播是开的，自动播放最新添加的一首
            this.play(playlist.length - 1);
        } else {
            // 如果没满足自动播放条件（例如关闭了连播，或者正在播放中），仅仅通知 UI 刷新，绝不触碰音频状态
            this._notifyStateChange();
        }
    }

    removeSong(index) {
        const playlist = this.getPlaylist();
        if (index < 0 || index >= playlist.length) return;

        const wasPlaying = this.isPlaying && this.currentIndex === index;
        playlist.splice(index, 1);

        if (wasPlaying) {
            this.audioPlayer.pause();
            this.isPlaying = false;
            // 尝试播放下一首
            if (playlist.length > 0) {
                this.currentIndex = Math.min(index, playlist.length - 1);
                this.play(this.currentIndex);
            } else {
                this.currentIndex = -1;
            }
        } else if (this.currentIndex > index) {
            this.currentIndex--;
        } else if (this.currentIndex >= playlist.length) {
            this.currentIndex = playlist.length - 1;
        }

        this.savePlaylist();
        this._notifyStateChange();
    }

    clearPlaylist() {
        this._playlist = [];
        // 仅当当前激活列表就是歌单时，才重置播放状态
        if (this.activeListType === 'playlist') {
            this.currentIndex = -1;
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
            this.isPlaying = false;
            this._userPaused = false; // 🔥 新增：重置标记
        }
        this.savePlaylist();
        this._notifyStateChange();
    }

    clearFavorites() {
        this._favorites = [];
        // 仅当当前激活列表就是收藏时，才重置播放状态
        if (this.activeListType === 'favorites') {
            this.currentIndex = -1;
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
            this.isPlaying = false;
            this._userPaused = false;
        }
        this.saveFavorites();
        this._notifyStateChange();
    }

    async searchSongs(query) {
        if (!query || query.trim() === '') {
            return [];
        }
        try {
            const searchQuery = encodeURIComponent(query);
            const response = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}`);
            const json = await response.json();

            if (json?.data && Array.isArray(json.data)) {
                // 格式化返回结果，方便视图层使用
                return json.data.map(item => ({
                    id: item.id,
                    name: item.song,
                    artist: item.singer || '未知',
                    pic: item.cover || item.pic || null
                }));
            }
            return [];
        } catch (e) {
            console.error('🎵 [音乐] 歌曲搜索失败:', e);
            return []; // 出错时返回空数组
        }
    }

    // ========== 播放控制 ==========

    async play(index, listType = this.activeListType) {
        this.activeListType = listType;
        const playlist = this.getActiveList();
        if (index < 0 || index >= playlist.length) return;

        const wasPlaying = this.isPlaying;
        // 递增代次号，使之前的 play() 调用自动失效
        const generation = ++this._playGeneration;
        this._playLock = true;
        this._userPaused = false;
        this.currentIndex = index;
        // 先停旧歌并立即刷新UI，给“上一曲/下一曲”即时反馈
        this.audioPlayer.pause();
        this.isPlaying = false;
        this._notifyStateChange();

        const song = playlist[index];

        try {
            // 如果没有URL，先获取
            if (!song.url) {
                const songKey = `${song.name}|${song.artist}`;
                if (this._failedSongs.has(songKey)) {
                    console.warn(`🎵 [音乐] 跳过已失败的歌曲: ${song.name}`);
                    this.isPlaying = false;
                    this._playLock = false;
                    this._notifyStateChange();
                    return;
                }

                const result = await this._fetchSongUrl(song.name, song.artist);

                if (generation !== this._playGeneration) return;

                if (result && result.url) {
                    song.url = result.url;
                    song.pic = result.pic;
                    song.lrc = result.lrc;
                    if (listType === 'favorites') this.saveFavorites();
                    else this.savePlaylist();
                } else {
                    this._failedSongs.add(songKey);
                    this._playLock = false;
                    this._recoverAndPlay(index);
                    return;
                }
            }

            if (generation !== this._playGeneration) return;

            this.audioPlayer.src = song.url;
            await this.audioPlayer.play();
            this.isPlaying = true;
            this._playLock = false;
            this._notifyStateChange();
            this._prefetchNeighbors(index, listType);
        } catch (e) {
            if (generation === this._playGeneration) {
                // 如果切歌失败且之前本来在播，尝试恢复上一状态的可用资源
                if (wasPlaying && this.audioPlayer.src) {
                    this.audioPlayer.play().catch(() => {});
                }
                this.isPlaying = false;
                this._playLock = false;
                this._notifyStateChange();
            }
        }
    }

    async _recoverAndPlay(songIndex) {
        const playlist = this.getActiveList();
        if (songIndex < 0 || songIndex >= playlist.length) return;

        const song = playlist[songIndex];

        // 防止对同一首歌无限重试
        if (song._autoRetried) {
            console.warn(`🎵 [音乐] 歌曲 "${song.name}" 已尝试修复过，跳过。`);
            this._notifyStateChange(); // 更新UI显示错误状态
            return;
        }
        song._autoRetried = true; // 标记为已尝试修复

        console.log(`🎵 [音乐] 正在为 "${song.name}" 自动搜索新链接...`);

        try {
            // 🔥 新增：毫秒级试听检测函数
            const checkFullSong = (url) => new Promise(resolve => {
                const a = new Audio();
                a.muted = true;
                const timer = setTimeout(() => resolve(true), 2500); 
                a.onloadedmetadata = () => {
                    clearTimeout(timer);
                    resolve(a.duration > 45); 
                };
                a.onerror = () => { clearTimeout(timer); resolve(false); };
                a.src = url;
            });

            const searchQuery = encodeURIComponent(`${song.name} ${song.artist}`);
            const searchRes = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}`);
            const searchJson = await searchRes.json();

            if (!searchJson?.data || searchJson.data.length === 0) {
                console.warn(`🎵 [音乐] 自动修复失败：未搜索到结果。`);
                return;
            }

            const oldId = song.id; // 记录旧的、已失效的ID

            // 遍历新的搜索结果，寻找一个不同的、可用的版本
            for (const candidate of searchJson.data) {
                if (candidate.id === oldId) continue; // 跳过已知的坏ID

                try {
                    const urlRes = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=song&id=${candidate.id}`);
                    const urlData = await urlRes.json();

                    if (urlData?.[0]?.url && !urlData[0].url.includes('music.163.com/404')) {
                        let newUrl = urlData[0].url.replace('http://', 'https://');

                        // 🔥 新增：检测修复到的新版本是不是坑人的30秒试听
                        const isFull = await checkFullSong(newUrl);
                        if (!isFull) {
                            console.warn(`🎵 [音乐] 修复找到的新版本仍是30秒试听，继续寻找下一个...`);
                            continue;
                        }

                        console.log(`✅ [音乐] 自动修复成功！找到完整版新链接 for "${song.name}"`);

                        // 更新播放列表中的歌曲信息
                        song.id = candidate.id;
                        song.url = newUrl;
                        song.pic = urlData[0].pic || song.pic;
                        delete song._autoRetried; // 成功后移除标记
                        if (this.activeListType === 'favorites') this.saveFavorites();
                        else this.savePlaylist();

                        // 使用新链接重新播放
                        this.play(songIndex);
                        return; // 成功找到，结束函数
                    }
                } catch (e) {
                    // 忽略单个候选版本的获取失败
                    continue;
                }
            }

            console.warn(`🎵 [音乐] 自动修复失败：所有替代版本均不可用。`);

        } catch (e) {
            console.error('🎵 [音乐] 自动修复过程中发生网络错误:', e);
        }
    }

    pause() {
        this.audioPlayer.pause();
        this.isPlaying = false;
        this._userPaused = true;
        this._notifyStateChange();
    }

    resume() {
        if (this.audioPlayer.src) {
            this.audioPlayer.play().then(() => {
                this.isPlaying = true;
                this._userPaused = false; // 🔥 新增：用户主动恢复播放，解除暂停标记
                this._notifyStateChange();
            }).catch(e => {
                console.warn('🎵 [音乐] 恢复播放失败:', e);
            });
        }
    }

    next() {
        const playlist = this.getActiveList();
        if (playlist.length === 0) return;
        const nextIndex = (this.currentIndex + 1) % playlist.length;
        this.play(nextIndex, this.activeListType);
    }

    prev() {
        const playlist = this.getActiveList();
        if (playlist.length === 0) return;
        const prevIndex = (this.currentIndex - 1 + playlist.length) % playlist.length;
        this.play(prevIndex, this.activeListType);
    }

    _prefetchNeighbors(index, listType = this.activeListType) {
        const playlist = (listType === 'favorites') ? this.getFavorites() : this.getPlaylist();
        if (!Array.isArray(playlist) || playlist.length <= 1) return;

        const nextIndex = (index + 1) % playlist.length;
        const prevIndex = (index - 1 + playlist.length) % playlist.length;
        this._prefetchSongAt(nextIndex, listType);
        this._prefetchSongAt(prevIndex, listType);
    }

    async _prefetchSongAt(index, listType = this.activeListType) {
        const playlist = (listType === 'favorites') ? this.getFavorites() : this.getPlaylist();
        const song = playlist[index];
        if (!song || song.url) return;

        const songKey = `${listType}:${song.name}|${song.artist}`;
        if (this._prefetching.has(songKey) || this._failedSongs.has(`${song.name}|${song.artist}`)) return;

        this._prefetching.add(songKey);
        try {
            const result = await this._fetchSongUrl(song.name, song.artist);
            if (result && result.url) {
                song.url = result.url;
                song.pic = result.pic;
                song.lrc = result.lrc;
                if (listType === 'favorites') this.saveFavorites();
                else this.savePlaylist();
            }
        } catch (e) {
            // 预取失败不打断主流程
        } finally {
            this._prefetching.delete(songKey);
        }
    }

    getCurrentSong() {
        const playlist = this.getActiveList();
        if (this.currentIndex >= 0 && this.currentIndex < playlist.length) {
            return playlist[this.currentIndex];
        }
        return null;
    }

    // ========== 自动连播 ==========

    _onTrackEnded() {
        if (this.getAutoPlay()) {
            this.next();
        } else {
            this.isPlaying = false;
            this._notifyStateChange();
        }
    }

    getAutoPlay() {
        const val = this.storage.get('music_auto_play', true);
        return val === true || val === 'true';
    }

    setAutoPlay(enabled) {
        this.storage.set('music_auto_play', enabled);
    }

    // ========== Music API ==========

    async _fetchSongUrl(name, artist) {
        try {
            // 🔥 新增：毫秒级试听检测函数 (时长小于45秒视为VIP试听版)
            const checkFullSong = (url) => new Promise(resolve => {
                const a = new Audio();
                a.muted = true;
                const timer = setTimeout(() => resolve(true), 2500); // 2.5秒超时放行，防止网络卡死
                a.onloadedmetadata = () => {
                    clearTimeout(timer);
                    resolve(a.duration > 45); // 完整歌曲肯定大于45秒
                };
                a.onerror = () => { clearTimeout(timer); resolve(false); };
                a.src = url;
            });

            const searchQuery = encodeURIComponent(name + ' ' + artist);

            // 1. 使用 vkeys API 搜索（支持CORS）
            let searchData = null;
            try {
                const vkeysRes = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}`);
                const vkeysJson = await vkeysRes.json();
                if (vkeysJson?.data && Array.isArray(vkeysJson.data) && vkeysJson.data.length > 0) {
                    searchData = vkeysJson.data;
                }
            } catch (e) {
                console.warn('🎵 [音乐] vkeys搜索失败:', e.message);
            }

            if (!searchData || searchData.length === 0) {
                console.warn(`🎵 [音乐] 搜索无结果: ${name} ${artist}`);
                return null;
            }

            // 2. 遍历搜索结果，尝试获取可用的播放URL
            for (const candidate of searchData.slice(0, 5)) {
                const songId = candidate.id;
                if (!songId) continue;

                let url = null;
                let pic = candidate.cover || candidate.pic || null;

                // 方案A：vkeys 获取播放链接
                try {
                    const urlRes = await fetch(`https://api.vkeys.cn/v2/music/netease?id=${songId}`);
                    const urlJson = await urlRes.json();
                    if (urlJson?.data?.url) {
                        url = urlJson.data.url;
                    }
                } catch (e) {
                    console.warn(`🎵 [音乐] vkeys获取URL失败(id:${songId}):`, e.message);
                }

                // 方案B：Meting API 兜底
                if (!url) {
                    try {
                        const metingRes = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=song&id=${songId}`);
                        const metingData = await metingRes.json();
                        if (metingData?.[0]?.url && !metingData[0].url.includes('music.163.com/404')) {
                            url = metingData[0].url;
                            if (!pic) pic = metingData[0].pic || null;
                        }
                    } catch (e) {
                        console.warn(`🎵 [音乐] meting获取URL失败(id:${songId}):`, e.message);
                    }
                }

                if (url) {
                    // 强制HTTPS
                    if (url.startsWith('http://')) {
                        url = url.replace('http://', 'https://');
                    }
                    
                    // 🔥 新增：快速验毒，如果是30秒试听版，直接抛弃并搜寻下一个！
                    const isFull = await checkFullSong(url);
                    if (!isFull) {
                        console.warn(`🎵 [音乐] 发现30秒试听VIP片段，自动跳过此版本: ${name} (ID: ${songId})`);
                        continue; // 直接进入下一轮循环，尝试下一个 candidate
                    }

                    return { url, pic, lrc: null };
                }
            }

            return null;
        } catch (e) {
            console.error('🎵 [音乐] API请求失败:', e);
            return null;
        }
    }

    // ========== 卡片数据 ==========

    setCardData(parsed) {
        this._cardData = parsed;
        // 持久化到 storage，以便切换聊天后恢复
        if (parsed) {
            this.storage.set('music_card_data', JSON.stringify(parsed));
        } else {
            this.storage.set('music_card_data', '');
        }
    }

    getCardData() {
        if (this._cardData) return this._cardData;
        // 从 storage 恢复
        const saved = this.storage.get('music_card_data', '');
        if (saved) {
            try {
                this._cardData = typeof saved === 'string' ? JSON.parse(saved) : saved;
            } catch (e) {
                this._cardData = null;
            }
        }
        return this._cardData;
    }

    // ========== 工具 ==========

    _notifyStateChange() {
        if (typeof this.onStateChange === 'function') {
            this.onStateChange();
        }
    }

    clearCache() {
        this._playlist = null;
        this.currentIndex = -1;
        this.audioPlayer.pause();
        this.audioPlayer.src = '';
        this.isPlaying = false;
        this._userPaused = false; // 🔥 新增：重置标记
        this._cardData = null;
        this._failedSongs.clear();
        this._playLock = false;
        this._playGeneration++;
    }
}
