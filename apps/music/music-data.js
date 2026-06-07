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

const MUSIC_EXTERNAL_SOURCE_URL = 'https://drive.baibai.cv/f/ZKEBuW/Music.js';
const MUSIC_EXTERNAL_SOURCE_ID = 'st-phone-baibai-music-source';

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
        this._failedSongs = new Map(); // 获取失败的歌曲，短时间内防止无限重试
        this._playLock = false;    // 防止并发播放请求
        this._playGeneration = 0;  // 播放请求代次，用于取消过期请求
        this._userPaused = false;  // 记录用户是否手动按了暂停
        this._prefetching = new Set(); // 预取中的歌曲，避免重复请求
        this._lyricCache = new Map(); // 歌词缓存，避免同一首歌重复请求
        this._externalMusicSourcePromise = null; // 备用音乐源懒加载任务
        this.onPlaybackStopped = null;

        // 音频事件绑定
        this.audioPlayer.addEventListener('ended', () => this._onTrackEnded());
        this.audioPlayer.addEventListener('error', (e) => {
            console.warn('🎵 [音乐] 播放出错:', e);
            this.isPlaying = false;
            this._playLock = false;

            const song = this.getCurrentSong();
            if (song && this.currentIndex >= 0 && !this._userPaused) {
                console.log(`🎵 [音乐] 检测到链接不可播放，尝试自动修复: ${song.name}`);
                this._invalidateSongUrl(song, this.activeListType);
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
        const targetKey = this._getSongDedupKey(song?.name, song?.artist);
        const index = favs.findIndex(s => this._getSongDedupKey(s?.name, s?.artist) === targetKey);
        if (index > -1) {
            favs.splice(index, 1);
        } else {
            const normalized = this._normalizeSongRecord(song?.name, song?.artist, song || {});
            if (normalized.name) favs.push({ ...song, ...normalized });
        }
        this.saveFavorites();
        this._notifyStateChange();
    }

    isFavorite(song) {
        const targetKey = this._getSongDedupKey(song?.name, song?.artist);
        return this.getFavorites().some(s => this._getSongDedupKey(s?.name, s?.artist) === targetKey);
    }

    getActiveList() {
        return this.activeListType === 'favorites' ? this.getFavorites() : this.getPlaylist();
    }

    _cleanSongText(value = '') {
        let text = String(value || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/｜/g, '|')
            .replace(/\s+/g, ' ')
            .trim();
        text = text
            .replace(/^\s*(?:-|--|—|–)?\s*by\s+/i, '')
            .replace(/\s*(?:-|--|—|–)?\s*by\s*$/i, '')
            .trim();
        let changed = true;
        while (changed && text.length > 1) {
            changed = false;
            const pairs = [
                ['【', '】'],
                ['《', '》'],
                ['〈', '〉'],
                ['「', '」'],
                ['『', '』'],
                ['[', ']'],
                ['(', ')'],
                ['（', '）'],
                ['"', '"'],
                ["'", "'"]
            ];
            for (const [left, right] of pairs) {
                if (text.startsWith(left) && text.endsWith(right)) {
                    text = text.slice(left.length, -right.length).trim();
                    changed = true;
                }
            }
        }
        return text;
    }

    _normalizeSongDedupPart(value = '') {
        return this._cleanSongText(value)
            .toLowerCase()
            .replace(/[【】《》〈〉「」『』\[\]（）()"'“”‘’]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    _getSongDedupKey(name = '', artist = '') {
        const songName = this._normalizeSongDedupPart(name);
        const artistName = this._normalizeSongDedupPart(artist);
        return `${songName}|${artistName}`;
    }

    _normalizeSongRecord(name, artist, meta = {}) {
        return {
            name: this._cleanSongText(name),
            artist: this._cleanSongText(artist || '未知') || '未知',
            id: meta.id || null,
            url: meta.url || null,
            pic: meta.pic || null,
            lrc: Array.isArray(meta.lrc) ? meta.lrc : null
        };
    }

    addSong(name, artist, meta = {}) {
        const playlist = this.getPlaylist();
        const record = this._normalizeSongRecord(name, artist, meta);
        if (!record.name) return false;

        // 去重
        const nextKey = this._getSongDedupKey(record.name, record.artist);
        const exists = playlist.some(s => this._getSongDedupKey(s?.name, s?.artist) === nextKey);
        if (exists) return false;

        playlist.push(record);
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
        return true;
    }

    async playSongByName(name, artist, meta = {}) {
        const safeName = this._cleanSongText(name);
        const safeArtist = this._cleanSongText(artist);
        if (!safeName) return false;

        this.activeListType = 'playlist';
        const playlist = this.getPlaylist();
        const targetKey = this._getSongDedupKey(safeName, safeArtist || '未知');
        let index = playlist.findIndex(song => this._getSongDedupKey(song?.name, song?.artist || '未知') === targetKey);

        if (index < 0) {
            playlist.push(this._normalizeSongRecord(safeName, safeArtist || '未知', meta));
            index = playlist.length - 1;
            this.savePlaylist();
        }

        await this.play(index, 'playlist');
        return this.getPlaylist()[index] || null;
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
        const wasPlaying = this.activeListType === 'playlist' && (this.isPlaying || !this.audioPlayer.paused);
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
        if (wasPlaying) this._notifyPlaybackStopped('clear_playlist');
    }

    clearFavorites() {
        const wasPlaying = this.activeListType === 'favorites' && (this.isPlaying || !this.audioPlayer.paused);
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
        if (wasPlaying) this._notifyPlaybackStopped('clear_favorites');
    }

    async searchSongs(query, options = {}) {
        if (!query || query.trim() === '') {
            return [];
        }
        try {
            const searchQuery = encodeURIComponent(query);
            const limit = Math.max(1, Math.min(80, Number.parseInt(options.limit, 10) || 50));
            const pageSize = Math.max(1, Math.min(20, Number.parseInt(options.pageSize, 10) || 20));
            const maxPages = Math.max(1, Math.ceil(limit / pageSize));
            const seen = new Set();
            const songs = [];

            for (let page = 1; page <= maxPages && songs.length < limit; page++) {
                const response = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}&page=${page}&num=${pageSize}`);
                const json = await response.json();
                const items = Array.isArray(json?.data) ? json.data : [];
                if (items.length === 0) break;

                let addedInPage = 0;
                items.forEach(item => {
                    const song = this._cleanSongText(item.song || item.name || '');
                    const singer = this._cleanSongText(item.singer || item.artist || '未知') || '未知';
                    if (!song) return null;
                    const key = this._getSongDedupKey(song, singer);
                    if (!key || seen.has(key)) return null;
                    seen.add(key);
                    songs.push({
                        id: item.id,
                        name: song,
                        artist: singer,
                        pic: item.cover || item.pic || null
                    });
                    addedInPage++;
                });

                if (items.length < pageSize || addedInPage === 0) break;
            }

            return songs.slice(0, limit);
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

        // 递增代次号，使之前的 play() 调用自动失效
        const generation = ++this._playGeneration;
        this._playLock = true;
        this._userPaused = false;
        this.currentIndex = index;
        // 先停旧歌并清空旧 src，避免新歌加载失败时继续播放上一首。
        this.audioPlayer.pause();
        this.audioPlayer.removeAttribute('src');
        this.audioPlayer.load();
        this.isPlaying = false;
        this._notifyStateChange();

        const song = playlist[index];

        try {
            // 如果没有URL，先获取
            if (!song.url) {
                const songKey = `${song.name}|${song.artist}`;
                if (this._isSongFetchTemporarilyFailed(songKey)) {
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
                    song.name = result.name || song.name;
                    song.artist = result.artist || song.artist || '未知';
                    song.pic = result.pic;
                    song.id = result.id || song.id || null;
                    song.urlSource = result.urlSource || song.urlSource || null;
                    song.lrc = result.lrc;
                    if (listType === 'favorites') this.saveFavorites();
                    else this.savePlaylist();
                } else {
                    this._markSongFetchFailed(songKey);
                    this._playLock = false;
                    this._recoverAndPlay(index);
                    return;
                }
            }

            if (generation !== this._playGeneration) return;

            await this._preferMetingSource(song, listType);
            if (generation !== this._playGeneration) return;

            this.audioPlayer.src = song.url;
            await this.audioPlayer.play();
            this.isPlaying = true;
            this._playLock = false;
            this._notifyStateChange();
            this._ensureLyrics(song, listType, generation);
            this._prefetchNeighbors(index, listType);
        } catch (e) {
            if (generation === this._playGeneration) {
                console.warn(`🎵 [音乐] 播放失败: ${song?.name || ''}`, e);
                this.isPlaying = false;
                this._playLock = false;
                this._notifyStateChange();
                if (song && !this._userPaused && e?.name !== 'NotAllowedError') {
                    this._invalidateSongUrl(song, listType);
                    this._recoverAndPlay(index);
                }
            }
        }
    }

    _invalidateSongUrl(song, listType = this.activeListType) {
        if (!song) return;
        song.url = null;
        song.urlSource = null;
        delete song._metingRefreshTried;
        if (listType === 'favorites') this.saveFavorites();
        else this.savePlaylist();
    }

    async _recoverAndPlay(songIndex) {
        const playlist = this.getActiveList();
        if (songIndex < 0 || songIndex >= playlist.length) return;

        const song = playlist[songIndex];

        const now = Date.now();
        if (song._autoRetrying || (song._lastAutoRetryAt && now - song._lastAutoRetryAt < 60000)) {
            console.warn(`🎵 [音乐] 歌曲 "${song.name}" 正在修复或刚修复失败，暂时跳过。`);
            this._notifyStateChange(); // 更新UI显示错误状态
            return;
        }
        song._autoRetrying = true;
        song._lastAutoRetryAt = now;

        console.log(`🎵 [音乐] 正在为 "${song.name}" 自动搜索新链接...`);

        const applyRecoveredSong = async (result, label = '备用音乐源') => {
            if (!result?.url) return false;
            console.log(`✅ [音乐] 自动修复成功！已切换到${label}: "${song.name}"`);
            song.id = result.id || song.id || null;
            song.url = result.url;
            song.urlSource = result.urlSource;
            song.name = result.name || song.name;
            song.artist = result.artist || song.artist || '未知';
            song.pic = result.pic || song.pic || null;
            song.lrc = Array.isArray(result.lrc) ? result.lrc : [];
            delete song._autoRetrying;
            delete song._lastAutoRetryAt;
            if (this.activeListType === 'favorites') this.saveFavorites();
            else this.savePlaylist();
            await this.play(songIndex);
            return true;
        };

        try {
            const searchQuery = encodeURIComponent(`${song.name} ${song.artist}`);
            let searchJson = null;
            try {
                const searchRes = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}`);
                searchJson = await searchRes.json();
            } catch (e) {
                console.warn('🎵 [音乐] 自动修复搜索失败，准备尝试备用源:', this._formatErrorForLog(e));
            }

            if (Array.isArray(searchJson?.data) && searchJson.data.length > 0) {
                // 遍历新的搜索结果，寻找一个不同的、可用的版本
                for (const candidate of searchJson.data) {
                    try {
                        const urlRes = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=song&id=${candidate.id}`);
                        const urlData = await urlRes.json();

                        if (urlData?.[0]?.url && !urlData[0].url.includes('music.163.com/404')) {
                            let newUrl = urlData[0].url.replace('http://', 'https://');

                            // 🔥 新增：检测修复到的新版本是不是坑人的30秒试听
                            const isFull = await this._checkPlayableSongUrl(newUrl);
                            if (!isFull) {
                                console.warn(`🎵 [音乐] 修复找到的新版本仍是30秒试听，继续寻找下一个...`);
                                continue;
                            }

                            console.log(`✅ [音乐] 自动修复成功！找到完整版新链接 for "${song.name}"`);

                            await applyRecoveredSong({
                                id: candidate.id,
                                url: newUrl,
                                urlSource: 'meting',
                                pic: urlData[0].pic || song.pic,
                                lrc: await this._fetchLyrics(candidate.id),
                                name: candidate.song || candidate.name || song.name,
                                artist: candidate.singer || candidate.artist || song.artist || '未知'
                            }, 'Meting 源');
                            return;
                        }
                    } catch (e) {
                        // 忽略单个候选版本的获取失败
                        continue;
                    }
                }
            } else {
                console.warn(`🎵 [音乐] 自动修复主源未搜索到结果: ${song.name} ${song.artist}`);
            }

        } catch (e) {
            console.warn('🎵 [音乐] 主源自动修复异常，继续尝试备用源:', this._formatErrorForLog(e));
        }

        try {
            const externalResult = await this._fetchExternalMusicSourceSong(song.name, song.artist);
            if (await applyRecoveredSong(externalResult, '备用音乐源')) return;
            console.warn(`🎵 [音乐] 自动修复失败：所有替代版本及备用源均不可用。`);
        } catch (e) {
            console.error('🎵 [音乐] 备用音乐源自动修复失败:', this._formatErrorForLog(e));
        } finally {
            delete song._autoRetrying;
        }
    }

    pause() {
        if (typeof window !== 'undefined'
            && window._musicSuppressNavigationPauseUntil
            && Date.now() < window._musicSuppressNavigationPauseUntil) {
            this._notifyStateChange();
            return;
        }
        const wasPlaying = this.isPlaying || !this.audioPlayer.paused;
        this.audioPlayer.pause();
        this.isPlaying = false;
        this._userPaused = true;
        this._notifyStateChange();
        if (wasPlaying) this._notifyPlaybackStopped('pause');
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
        if (this._prefetching.has(songKey) || this._isSongFetchTemporarilyFailed(`${song.name}|${song.artist}`)) return;

        this._prefetching.add(songKey);
        try {
            const result = await this._fetchSongUrl(song.name, song.artist);
            if (result && result.url) {
                song.url = result.url;
                song.pic = result.pic;
                song.id = result.id || song.id || null;
                song.urlSource = result.urlSource || song.urlSource || null;
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

    getListeningSnapshot() {
        const song = this.getCurrentSong();
        if (!song) return null;

        const currentTime = Number.isFinite(this.audioPlayer.currentTime) ? this.audioPlayer.currentTime : 0;
        const duration = Number.isFinite(this.audioPlayer.duration) ? this.audioPlayer.duration : 0;
        const lyrics = Array.isArray(song.lrc) ? song.lrc : [];
        let lyricIndex = -1;
        if (lyrics.length > 0) {
            const nextIndex = lyrics.findIndex(line => Number(line?.t || 0) > currentTime);
            lyricIndex = nextIndex === -1 ? lyrics.length - 1 : Math.max(0, nextIndex - 1);
        }
        const lyricLine = lyricIndex >= 0 ? lyrics[lyricIndex] : null;
        const aroundLyrics = lyricIndex >= 0
            ? lyrics.slice(Math.max(0, lyricIndex - 1), Math.min(lyrics.length, lyricIndex + 2))
                .map(line => String(line?.txt || '').trim())
                .filter(Boolean)
            : [];
        const lyricWindow = lyrics.length > 0
            ? lyrics
                .filter(line => {
                    const lineTime = Number(line?.t);
                    return Number.isFinite(lineTime) && lineTime >= currentTime + 40 && lineTime <= currentTime + 80;
                })
                .slice(0, 18)
                .map(line => {
                    const text = String(line?.txt || '').trim();
                    const trans = String(line?.tr || '').trim();
                    if (!text) return '';
                    return trans ? `${this._formatListenTime(line.t)} ${text}（${trans}）` : `${this._formatListenTime(line.t)} ${text}`;
                })
                .filter(Boolean)
            : [];
        const playlistSongs = this._formatSongListForPrompt(this.getPlaylist());
        const favoriteSongs = this._formatSongListForPrompt(this.getFavorites());

        return {
            songId: song.id || '',
            songName: song.name || '未知歌曲',
            artist: song.artist || '未知歌手',
            cover: song.pic || '',
            currentTime,
            duration,
            isPlaying: !!this.isPlaying,
            lyric: lyricLine ? String(lyricLine.txt || '').trim() : '',
            lyricTranslation: lyricLine ? String(lyricLine.tr || '').trim() : '',
            lyricAround: aroundLyrics,
            lyricWindow,
            playlistSongs,
            favoriteSongs,
            activeListType: this.activeListType
        };
    }

    _formatListenTime(seconds = 0) {
        const value = Math.max(0, Number(seconds || 0));
        const m = Math.floor(value / 60);
        const s = Math.floor(value % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    _formatSongListForPrompt(list = []) {
        return (Array.isArray(list) ? list : [])
            .map(song => {
                const name = String(song?.name || '').trim();
                const artist = String(song?.artist || '').trim();
                if (!name && !artist) return '';
                return artist ? `${name} - ${artist}` : name;
            })
            .filter(Boolean)
            .slice(0, 40);
    }

    // ========== 自动连播 ==========

    _onTrackEnded() {
        if (this.getAutoPlay()) {
            this.next();
        } else {
            this.isPlaying = false;
            this._notifyStateChange();
            this._notifyPlaybackStopped('ended');
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
                return await this._fetchExternalMusicSourceSong(name, artist);
            }

            // 2. 遍历搜索结果，尝试获取可用的播放URL
            for (const candidate of searchData.slice(0, 15)) {
                const songId = candidate.id;
                if (!songId) continue;

                let url = null;
                let urlSource = null;
                let pic = candidate.cover || candidate.pic || null;

                // 方案A：Meting 获取播放链接。歌词也来自同一 ID，优先保持音频和歌词版本一致。
                try {
                    const metingRes = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=song&id=${songId}`);
                    const metingData = await metingRes.json();
                    if (metingData?.[0]?.url && !metingData[0].url.includes('music.163.com/404')) {
                        url = metingData[0].url;
                        urlSource = 'meting';
                        if (!pic) pic = metingData[0].pic || null;
                    }
                } catch (e) {
                    console.warn(`🎵 [音乐] meting获取URL失败(id:${songId}):`, e.message);
                }

                // 方案B：vkeys 兜底
                if (!url) {
                    try {
                        const urlRes = await fetch(`https://api.vkeys.cn/v2/music/netease?id=${songId}`);
                        const urlJson = await urlRes.json();
                        if (urlJson?.data?.url) {
                            url = urlJson.data.url;
                            urlSource = 'vkeys';
                        }
                    } catch (e) {
                        console.warn(`🎵 [音乐] vkeys获取URL失败(id:${songId}):`, e.message);
                    }
                }

                if (url) {
                    // 强制HTTPS
                    if (url.startsWith('http://')) {
                        url = url.replace('http://', 'https://');
                    }
                    
                    // 🔥 新增：快速验毒，如果是30秒试听版，直接抛弃并搜寻下一个！
                    const isFull = await this._checkPlayableSongUrl(url);
                    if (!isFull) {
                        console.warn(`🎵 [音乐] 发现30秒试听VIP片段，自动跳过此版本: ${name} (ID: ${songId})`);
                        continue; // 直接进入下一轮循环，尝试下一个 candidate
                    }

                    return {
                        url,
                        pic,
                        id: songId,
                        urlSource,
                        lrc: null,
                        name: candidate.song || candidate.name || name,
                        artist: candidate.singer || candidate.artist || artist || ''
                    };
                }
            }

            return await this._fetchExternalMusicSourceSong(name, artist);
        } catch (e) {
            console.error('🎵 [音乐] API请求失败:', e);
            return await this._fetchExternalMusicSourceSong(name, artist);
        }
    }

    async _preferMetingSource(song, listType = this.activeListType) {
        if (!song || song.urlSource === 'meting' || song.urlSource === 'baibai-music' || song._metingRefreshTried) return;

        song._metingRefreshTried = true;
        try {
            if (!song.id) {
                const resolved = await this._findSongMeta(song.name, song.artist);
                if (resolved?.id) {
                    song.id = resolved.id;
                    if (!song.pic && resolved.pic) song.pic = resolved.pic;
                }
            }

            if (!song.id) return;

            const metingRes = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=song&id=${encodeURIComponent(song.id)}`);
            const metingData = await metingRes.json();
            let metingUrl = metingData?.[0]?.url || '';
            if (!metingUrl || metingUrl.includes('music.163.com/404')) return;

            if (metingUrl.startsWith('http://')) {
                metingUrl = metingUrl.replace('http://', 'https://');
            }

            const isPlayable = await this._checkPlayableSongUrl(metingUrl);
            if (!isPlayable) return;

            song.url = metingUrl;
            song.urlSource = 'meting';
            song.pic = metingData[0].pic || song.pic;
            if (listType === 'favorites') this.saveFavorites();
            else this.savePlaylist();
        } catch (e) {
            console.warn(`🎵 [音乐] 切换同源歌词音频失败: ${song.name}`, e);
        }
    }

    async _ensureExternalMusicSource() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return null;

        const existingApi = window.Music || globalThis.Music;
        if (typeof existingApi?.SearchMusic === 'function') return existingApi;

        if (this._externalMusicSourcePromise) return this._externalMusicSourcePromise;

        this._externalMusicSourcePromise = new Promise(resolve => {
            let settled = false;
            const finish = (api = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(api);
            };
            const timer = setTimeout(() => {
                console.warn('🎵 [音乐] 备用音乐源加载超时');
                finish(null);
            }, 10000);

            const script = document.getElementById(MUSIC_EXTERNAL_SOURCE_ID)
                || document.querySelector(`script[src="${MUSIC_EXTERNAL_SOURCE_URL}"]`);

            const onReady = () => {
                const api = window.Music || globalThis.Music;
                if (typeof api?.SearchMusic === 'function') finish(api);
                else finish(null);
            };

            if (script) {
                script.addEventListener('load', onReady, { once: true });
                script.addEventListener('error', () => finish(null), { once: true });
                return;
            }

            const node = document.createElement('script');
            node.id = MUSIC_EXTERNAL_SOURCE_ID;
            node.src = MUSIC_EXTERNAL_SOURCE_URL;
            node.async = true;
            node.onload = onReady;
            node.onerror = () => {
                console.warn('🎵 [音乐] 备用音乐源脚本加载失败');
                finish(null);
            };
            document.head.appendChild(node);
        }).finally(() => {
            this._externalMusicSourcePromise = null;
        });

        return this._externalMusicSourcePromise;
    }

    async _fetchExternalMusicSourceSong(name, artist) {
        const safeName = this._cleanSongText(name);
        const safeArtist = this._cleanSongText(artist);
        if (!safeName) return null;

        try {
            const api = await this._ensureExternalMusicSource();
            if (typeof api?.SearchMusic !== 'function') return null;

            const queries = [
                `${safeName} ${safeArtist}`.trim(),
                safeName
            ].filter((value, index, arr) => value && arr.indexOf(value) === index);

            for (const query of queries) {
                let raw = null;
                try {
                    raw = await Promise.resolve(api.SearchMusic(query));
                } catch (error) {
                    console.warn(`🎵 [音乐] 备用音乐源搜索失败: ${query}`, error?.message || error);
                    continue;
                }
                const normalized = this._normalizeExternalMusicResult(raw, safeName, safeArtist);
                if (!normalized?.url) continue;

                const isPlayable = await this._checkAudioAvailability(normalized.url);
                if (!isPlayable) {
                    console.warn(`🎵 [音乐] 备用音乐源返回不可播放链接，已跳过: ${normalized.name}`);
                    continue;
                }

                return normalized;
            }
        } catch (e) {
            console.warn(`🎵 [音乐] 备用音乐源不可用: ${safeName}`, e);
        }

        return null;
    }

    _formatErrorForLog(error) {
        if (!error) return '';
        if (typeof error === 'string') return error;
        const message = String(error.message || '').trim();
        const name = String(error.name || '').trim();
        const stack = String(error.stack || '').trim();
        if (message || name) return `${name ? `${name}: ` : ''}${message || stack || String(error)}`;
        try {
            return JSON.stringify(error);
        } catch (_e) {
            return String(error);
        }
    }

    _normalizeExternalMusicResult(raw, fallbackName, fallbackArtist) {
        if (!raw) return null;
        const source = Array.isArray(raw) ? raw[0] : raw;
        if (!source || typeof source !== 'object') return null;

        let url = String(source.Url || source.url || source.URL || source.data?.Url || source.data?.url || '').trim();
        if (!url) return null;
        if (url.startsWith('http://')) {
            url = url.replace('http://', 'https://');
        }

        const lyricText = String(source.Lyric || source.lyric || source.Lrc || source.lrc || '').trim();
        const parsedLyrics = lyricText ? this._parseLrc(lyricText).map(line => ({ ...line, tr: '' })) : [];
        const name = this._cleanSongText(source.Name || source.name || source.Song || source.song || fallbackName);
        const artist = this._cleanSongText(source.Singer || source.singer || source.Artist || source.artist || fallbackArtist || '未知') || '未知';

        return {
            url,
            pic: source.Pic || source.pic || source.Cover || source.cover || null,
            id: source.Id || source.id || `baibai:${this._getSongDedupKey(name, artist)}`,
            urlSource: 'baibai-music',
            lrc: parsedLyrics,
            name,
            artist
        };
    }

    _checkAudioAvailability(url) {
        return new Promise(resolve => {
            const safeUrl = String(url || '').trim();
            if (!safeUrl) {
                resolve(false);
                return;
            }
            const audio = new Audio();
            let timer = null;
            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', onReady);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onError);
                clearTimeout(timer);
                audio.removeAttribute('src');
                audio.load();
            };
            const onReady = () => {
                cleanup();
                resolve(true);
            };
            const onError = () => {
                cleanup();
                resolve(false);
            };
            audio.preload = 'metadata';
            audio.muted = true;
            timer = setTimeout(onError, 3000);
            audio.addEventListener('loadedmetadata', onReady);
            audio.addEventListener('canplay', onReady);
            audio.addEventListener('error', onError);
            audio.src = safeUrl;
        });
    }

    _checkPlayableSongUrl(url) {
        return new Promise(resolve => {
            const safeUrl = String(url || '').trim();
            if (!safeUrl) {
                resolve(false);
                return;
            }
            const audio = new Audio();
            audio.preload = 'metadata';
            audio.muted = true;
            const cleanup = () => {
                clearTimeout(timer);
                audio.onloadedmetadata = null;
                audio.onerror = null;
                audio.removeAttribute('src');
                audio.load();
            };
            const timer = setTimeout(() => {
                cleanup();
                resolve(true);
            }, 2500);
            audio.onloadedmetadata = () => {
                const duration = Number(audio.duration);
                cleanup();
                resolve(!Number.isFinite(duration) || duration > 45);
            };
            audio.onerror = () => {
                cleanup();
                resolve(true);
            };
            audio.src = safeUrl;
        });
    }

    async _ensureLyrics(song, listType = this.activeListType, generation = this._playGeneration) {
        if (!song || Array.isArray(song.lrc) || song._lrcLoading) return;

        song._lrcLoading = true;
        this._notifyStateChange();

        try {
            if (!song.id) {
                const resolved = await this._findSongMeta(song.name, song.artist);
                if (resolved?.id) {
                    song.id = resolved.id;
                    if (!song.pic && resolved.pic) song.pic = resolved.pic;
                }
            }
            song.lrc = await this._fetchLyrics(song.id);
        } catch (e) {
            song.lrc = [];
        } finally {
            delete song._lrcLoading;
        }

        if (listType === 'favorites') this.saveFavorites();
        else this.savePlaylist();

        if (generation === this._playGeneration || this.getCurrentSong() === song) {
            this._notifyStateChange();
        }
    }

    async _findSongMeta(name, artist) {
        if (!name) return null;

        try {
            const searchQuery = encodeURIComponent(`${name} ${artist || ''}`.trim());
            const response = await fetch(`https://api.vkeys.cn/v2/music/netease?word=${searchQuery}`);
            const json = await response.json();
            const candidate = Array.isArray(json?.data) ? json.data.find(item => item?.id) : null;
            if (!candidate) return null;

            return {
                id: candidate.id,
                pic: candidate.cover || candidate.pic || null,
                name: candidate.song || candidate.name || name,
                artist: candidate.singer || candidate.artist || artist || ''
            };
        } catch (e) {
            console.warn(`🎵 [音乐] 歌词补查歌曲ID失败: ${name}`, e);
            return null;
        }
    }

    async _fetchLyrics(songId) {
        if (!songId) return [];
        const cacheKey = String(songId);
        if (this._lyricCache.has(cacheKey)) {
            return this._lyricCache.get(cacheKey);
        }

        try {
            const lrcText = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=lrc&id=${encodeURIComponent(songId)}`).then(r => r.text());
            if (!lrcText || lrcText.includes('[00:00.00]暂无歌词') || lrcText.includes('暂无歌词')) {
                this._lyricCache.set(cacheKey, []);
                return [];
            }

            const mainLines = this._parseLrc(lrcText);
            if (mainLines.length === 0) {
                this._lyricCache.set(cacheKey, []);
                return [];
            }

            const transText = await fetch(`https://api.qijieya.cn/meting/?server=netease&type=lrc&id=${encodeURIComponent(songId)}&type=tlrc`)
                .then(r => r.text())
                .catch(() => '');
            const transLines = transText ? this._parseLrc(transText) : [];

            const lyrics = mainLines.map(line => {
                const trans = transLines.find(item => Math.abs(item.t - line.t) < 1);
                return {
                    t: line.t,
                    txt: line.txt,
                    tr: trans ? trans.txt : ''
                };
            });

            this._lyricCache.set(cacheKey, lyrics);
            return lyrics;
        } catch (e) {
            console.warn(`🎵 [音乐] 歌词获取失败(id:${songId}):`, e);
            this._lyricCache.set(cacheKey, []);
            return [];
        }
    }

    _parseLrc(text) {
        const lines = [];
        const timeRegex = /\[(\d+):(\d+)(\.\d+)?\]/g;

        String(text || '').split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) return;

            const matches = [...line.matchAll(timeRegex)];
            if (matches.length === 0) return;

            const lyricText = line.replace(timeRegex, '').trim();
            if (!lyricText) return;

            matches.forEach(match => {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const fraction = match[3] ? parseFloat(`0${match[3]}`) : 0;
                lines.push({
                    t: minutes * 60 + seconds + fraction,
                    txt: lyricText
                });
            });
        });

        return lines.sort((a, b) => a.t - b.t);
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

    _notifyPlaybackStopped(reason = '') {
        if (typeof this.onPlaybackStopped === 'function') {
            this.onPlaybackStopped(reason);
        }
    }

    _isSongFetchTemporarilyFailed(songKey) {
        const failedAt = Number(this._failedSongs.get(songKey) || 0);
        if (!failedAt) return false;
        if (Date.now() - failedAt > 60000) {
            this._failedSongs.delete(songKey);
            return false;
        }
        return true;
    }

    _markSongFetchFailed(songKey) {
        this._failedSongs.set(songKey, Date.now());
    }

    clearCache() {
        const wasPlaying = this.isPlaying || !this.audioPlayer.paused;
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
        this._lyricCache.clear();
        if (wasPlaying) this._notifyPlaybackStopped('clear');
    }
}
