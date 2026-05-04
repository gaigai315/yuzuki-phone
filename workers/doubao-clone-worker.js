const CLONE_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload';
const STATUS_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/status';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(body, init = {}) {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            ...corsHeaders,
            ...(init.headers || {})
        }
    });
}

function normalizeCloneError(data = {}) {
    const code = data?.BaseResp?.StatusCode || 'N/A';
    let message = data?.BaseResp?.StatusMessage || data?.message || '未知错误';
    if (code === 1106) message += ' (Speaker ID 重复)';
    else if (code === 1107) message += ' (Speaker ID 未找到)';
    else if (code === 1111) message += ' (音频无人声)';
    else if (code === 1122) message += ' (未检测到人声)';
    else if (code === 1123) message += ' (已达上传限制)';
    return message;
}

function normalizeAccessToken(accessToken = '') {
    return String(accessToken || '').trim().replace(/^Bearer\s*;?\s*/i, '');
}

async function handleClone(request) {
    const { accessToken, appId, speakerId, audioBase64, audioFormat, modelType, language } = await request.json();
    const safeAccessToken = normalizeAccessToken(accessToken);
    if (!safeAccessToken || !appId || !speakerId || !audioBase64) {
        return jsonResponse({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const model = Number.parseInt(modelType, 10) || 4;
    const resourceId = model === 4 ? 'seed-icl-2.0' : 'seed-icl-1.0';
    const response = await fetch(CLONE_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer; ${safeAccessToken}`,
            'Resource-Id': resourceId,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            appid: appId,
            speaker_id: speakerId,
            audios: [{ audio_bytes: audioBase64, audio_format: audioFormat || 'mp3' }],
            source: 2,
            model_type: model,
            language: Number.parseInt(language, 10) || 0
        })
    });

    const responseText = await response.text();
    let data = {};
    try { data = JSON.parse(responseText); } catch (_e) {}
    if (!response.ok) {
        return jsonResponse({
            success: false,
            error: `豆包接口 HTTP ${response.status}${responseText ? `：${responseText.slice(0, 300)}` : ''}`
        }, { status: response.status });
    }
    if (data?.BaseResp?.StatusCode === 0) {
        return jsonResponse({
            success: true,
            speakerId: data.speaker_id || speakerId,
            resourceId,
            message: `音色 ${data.speaker_id || speakerId} 上传成功`
        });
    }
    return jsonResponse({ success: false, error: normalizeCloneError(data), raw: data }, { status: 400 });
}

async function handleStatus(request) {
    const { accessToken, appId, speakerId, resourceId } = await request.json();
    const safeAccessToken = normalizeAccessToken(accessToken);
    if (!safeAccessToken || !appId || !speakerId) {
        return jsonResponse({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const response = await fetch(STATUS_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer; ${safeAccessToken}`,
            'Resource-Id': resourceId || 'seed-icl-2.0',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            appid: appId,
            speaker_id: speakerId
        })
    });

    const responseText = await response.text();
    let data = {};
    try { data = JSON.parse(responseText); } catch (_e) {}
    if (!response.ok) {
        return jsonResponse({
            success: false,
            error: `豆包接口 HTTP ${response.status}${responseText ? `：${responseText.slice(0, 300)}` : ''}`
        }, { status: response.status });
    }
    if (data?.BaseResp?.StatusCode === 0) {
        const statusMap = { 0: '未找到', 1: '训练中', 2: '训练成功', 3: '训练失败', 4: '已激活' };
        return jsonResponse({
            success: true,
            status: data.status,
            statusText: statusMap[data.status] || '未知',
            version: data.version
        });
    }
    return jsonResponse({ success: false, error: normalizeCloneError(data), raw: data }, { status: 400 });
}

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        try {
            if (url.pathname === '/' && request.method === 'GET') {
                return new Response('Yuzuki Phone Doubao clone worker is running.', {
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders }
                });
            }
            if (url.pathname === '/api/clone' && request.method === 'POST') {
                return await handleClone(request);
            }
            if (url.pathname === '/api/status' && request.method === 'POST') {
                return await handleStatus(request);
            }
            return jsonResponse({ success: false, error: 'Not Found' }, { status: 404 });
        } catch (error) {
            return jsonResponse({ success: false, error: error?.message || 'Worker 执行失败' }, { status: 500 });
        }
    }
};
