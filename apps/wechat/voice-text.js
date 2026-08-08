const VOICE_TRANSCRIPT_PREFIX_REGEX = /^(?:语音条?\s*)?(?:转文字|转文本|转写|转录|转化出的文字|转化文字|转换文字|文字内容|内容)\s*[：:]\s*/i;

export function stripVoiceParentheticalContent(value = '') {
    let text = String(value || '');
    let previous = '';

    do {
        previous = text;
        text = text
            .replace(/\([^()]*\)/g, '')
            .replace(/（[^（）]*）/g, '');
    } while (text !== previous);

    return text
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([，。！？、；：,.!?;:])/g, '$1')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function normalizeWechatVoiceText(value = '') {
    let text = String(value || '').trim();
    const wrappedVoiceMatch = text.match(/^[（(]\s*([\s\S]*?)\s*[)）]$/);
    if (wrappedVoiceMatch) {
        text = String(wrappedVoiceMatch[1] || '').trim();
    }

    text = text
        .replace(VOICE_TRANSCRIPT_PREFIX_REGEX, '')
        .replace(/^语音条转文字内容\s*[：:]\s*/i, '')
        .trim();

    return stripVoiceParentheticalContent(text);
}
