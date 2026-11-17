// 第三方插件生图契约 v1。内部管理器可变更，公开输入和返回值保持兼容。
const PROVIDERS = new Set(['novelai', 'openai', 'siliconflow', 'sd', 'comfyui']);

function apiError(code, message) {
    const error = new Error(message);
    error.name = code === 'ABORTED' ? 'AbortError' : 'YuzukiImageError';
    error.code = code;
    return error;
}

function checkAbort(signal) {
    if (signal?.aborted) throw apiError('ABORTED', '生图任务已取消');
}

export function createPublicImageAPI(getManager, fetchImage = (...args) => globalThis.fetch(...args)) {
    function getStatus() {
        try {
            const manager = getManager();
            if (!manager?.generate || !manager?.getConfig) {
                return { version: 1, ready: false, code: 'NOT_READY', provider: '', model: '' };
            }
            const config = manager.getConfig({ app: 'story' });
            let code = '';
            if (!config.enabled) code = 'DISABLED';
            else if (!PROVIDERS.has(config.provider)) code = 'UNSUPPORTED_PROVIDER';
            else if (!['sd', 'comfyui'].includes(config.provider) && !config.apiKey) code = 'NOT_CONFIGURED';
            else if (config.provider === 'sd' && !config.sdUrl) code = 'NOT_CONFIGURED';
            else if (config.provider === 'comfyui' && !config.comfyuiUrl) code = 'NOT_CONFIGURED';
            else if (config.provider === 'novelai' && config.site === 'public' && !config.publicUrl) code = 'NOT_CONFIGURED';
            else if (config.provider === 'openai' && config.openaiSite === 'public' && !config.openaiPublicUrl) code = 'NOT_CONFIGURED';
            return {
                version: 1, ready: !code, code,
                provider: String(config.provider || ''), model: String(config.model || '')
            };
        } catch {
            return { version: 1, ready: false, code: 'NOT_READY', provider: '', model: '' };
        }
    }

    async function generate(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)
            || Object.keys(options).some(key => !['prompt', 'negativePrompt', 'signal'].includes(key))
            || typeof options.prompt !== 'string' || !options.prompt.trim()
            || (options.negativePrompt !== undefined && typeof options.negativePrompt !== 'string')
            || (options.signal !== undefined && (!options.signal
                || typeof options.signal.aborted !== 'boolean'
                || typeof options.signal.addEventListener !== 'function'
                || typeof options.signal.removeEventListener !== 'function'))) {
            throw apiError('INVALID_ARGS', '请提供非空 prompt、可选 negativePrompt 和 AbortSignal');
        }
        const { signal } = options;
        checkAbort(signal);
        const status = getStatus();
        if (!status.ready) throw apiError(status.code, '请在柚月小手机中启用并配置正文生图');
        let result;
        try {
            // 明确列出参数，外部不能覆盖服务商、密钥、配置或启用开关。
            result = await getManager().generate({
                app: 'story', prompt: options.prompt.trim(),
                ...(options.negativePrompt !== undefined ? { additionalNegativePrompt: options.negativePrompt } : {}),
                signal
            });
            checkAbort(signal);
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw apiError('ABORTED', '生图任务已取消');
            // 上游错误可能包含请求地址等配置，不作为公开接口的错误返回。
            throw apiError('GENERATION_FAILED', '生图失败，请检查小手机生图配置或稍后重试');
        }
        if (String(result?.mediaType || '').toLowerCase() === 'video') {
            throw apiError('INVALID_RESULT', '公开生图接口仅支持图片');
        }
        let blob;
        try {
            if (result?.blob instanceof Blob) blob = result.blob;
            else {
                const source = result?.imageUrl || result?.imageData;
                if (typeof source !== 'string' || !source.trim()) throw new Error('empty');
                const response = await fetchImage(source, { signal });
                if (!response.ok) throw new Error('fetch');
                blob = await response.blob();
            }
            checkAbort(signal);
            if (!blob.size || !blob.type.toLowerCase().startsWith('image/')) throw new Error('mime');
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw apiError('ABORTED', '生图任务已取消');
            throw apiError('INVALID_RESULT', '未能读取有效的图片结果');
        }
        return {
            version: 1, blob, mimeType: blob.type,
            provider: String(result?.provider || status.provider),
            model: String(result?.model || status.model),
            width: Number.isFinite(result?.width) ? result.width : null,
            height: Number.isFinite(result?.height) ? result.height : null,
            seed: Number.isSafeInteger(result?.seed) && result.seed >= 0 ? result.seed : null
        };
    }

    return Object.freeze({ version: 1, getStatus, generate });
}
