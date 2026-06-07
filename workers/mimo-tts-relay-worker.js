const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key'
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

function normalizeBaseUrl(apiUrl = '') {
    const rawInput = String(apiUrl || '').trim();
    if (!rawInput) return '';
    const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput.replace(/^\/+/, '')}`;
    const raw = withProtocol.replace(/\/+$/, '');
    return raw
        .replace(/\/(?:v1\/)?chat\/completions$/i, '')
        .replace(/\/chat$/i, '')
        .replace(/\/(?:v1\/)?audio\/speech$/i, '')
        .replace(/\/audio$/i, '')
        .replace(/\/(?:v1\/)?models$/i, '');
}

function resolveTargetUrl(apiUrl = '', target = 'speech') {
    const rawInput = String(apiUrl || '').trim();
    if (!rawInput) return '';
    const withProtocol = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput.replace(/^\/+/, '')}`;
    const raw = withProtocol.replace(/\/+$/, '');
    if (target === 'speech') {
        if (/\/(?:v1\/)?audio\/speech$/i.test(raw)) return raw;
        if (/\/audio$/i.test(raw)) return `${raw}/speech`;
    }
    if (target === 'chat') {
        if (/\/(?:v1\/)?chat\/completions$/i.test(raw)) return raw;
        if (/\/chat$/i.test(raw)) return `${raw}/completions`;
    }
    if (target === 'models' && /\/(?:v1\/)?models$/i.test(raw)) return raw;
    const baseUrl = normalizeBaseUrl(apiUrl);
    if (!baseUrl) return '';
    if (target === 'chat') {
        if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
        return `${baseUrl}/v1/chat/completions`;
    }
    if (/\/v1$/i.test(baseUrl)) return target === 'models' ? `${baseUrl}/models` : `${baseUrl}/audio/speech`;
    return target === 'models' ? `${baseUrl}/v1/models` : `${baseUrl}/v1/audio/speech`;
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (_e) {
        return {};
    }
}

async function handleSpeech(request) {
    const body = await readJson(request);
    const apiUrl = String(body.apiUrl || body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
    const targetUrl = resolveTargetUrl(apiUrl, 'speech');

    if (!targetUrl || !apiKey || !payload) {
        return jsonResponse({ success: false, error: '缺少 apiUrl、apiKey 或 payload' }, { status: 400 });
    }

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        return jsonResponse({
            success: false,
            error: `MiMo 公益站 HTTP ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`
        }, { status: response.status });
    }

    const audio = await response.arrayBuffer();
    return new Response(audio, {
        status: response.status,
        headers: {
            ...corsHeaders,
            'Content-Type': contentType || 'audio/wav',
            'Cache-Control': 'no-store'
        }
    });
}

async function handleChat(request) {
    const body = await readJson(request);
    const apiUrl = String(body.apiUrl || body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
    const targetUrl = resolveTargetUrl(apiUrl, 'chat');

    if (!targetUrl || !apiKey || !payload) {
        return jsonResponse({ success: false, error: '缺少 apiUrl、apiKey 或 payload' }, { status: 400 });
    }

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text().catch(() => '');
    if (!response.ok) {
        return jsonResponse({
            success: false,
            error: `MiMo HTTP ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`
        }, { status: response.status });
    }

    return new Response(text, {
        status: response.status,
        headers: {
            ...corsHeaders,
            'Content-Type': response.headers.get('Content-Type') || 'application/json;charset=UTF-8',
            'Cache-Control': 'no-store'
        }
    });
}

async function handleModels(request) {
    const body = await readJson(request);
    const apiUrl = String(body.apiUrl || body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    const targetUrl = resolveTargetUrl(apiUrl, 'models');

    if (!targetUrl) {
        return jsonResponse({ success: false, error: '缺少 apiUrl' }, { status: 400 });
    }

    const headers = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
        headers['api-key'] = apiKey;
    }

    const response = await fetch(targetUrl, {
        method: 'GET',
        headers
    });
    const text = await response.text().catch(() => '');
    let data = null;
    try {
        data = JSON.parse(text || '{}');
    } catch (_e) {
        data = { raw: text };
    }

    if (!response.ok) {
        return jsonResponse({
            success: false,
            error: `MiMo 模型列表 HTTP ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`,
            raw: data
        }, { status: response.status });
    }

    return jsonResponse(data);
}

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        try {
            if (url.pathname === '/' && request.method === 'GET') {
                return new Response('Yuzuki Phone MiMo TTS relay worker is running.', {
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders }
                });
            }
            if (url.pathname === '/api/speech' && request.method === 'POST') {
                return await handleSpeech(request);
            }
            if (url.pathname === '/api/chat' && request.method === 'POST') {
                return await handleChat(request);
            }
            if (url.pathname === '/api/models' && request.method === 'POST') {
                return await handleModels(request);
            }
            return jsonResponse({ success: false, error: 'Not Found' }, { status: 404 });
        } catch (error) {
            return jsonResponse({ success: false, error: error?.message || 'Worker 执行失败' }, { status: 500 });
        }
    }
};
