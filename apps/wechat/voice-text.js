const VOICE_TRANSCRIPT_PREFIX_REGEX = /^(?:语音条?\s*)?(?:转文字|转文本|转写|转录|转化出的文字|转化文字|转换文字|文字内容|内容)\s*[：:]\s*/i;
const WECHAT_TRANSLATION_REGEX = /(?:\[\s*翻译\s*[：:]\s*([^\]\r\n]*)\]|【\s*翻译\s*[：:]\s*([^】\r\n]*)】)/gi;
const WECHAT_INNER_THOUGHT_REGEX = /\[\s*内心\s*\]\s*[（(]\s*([\s\S]*?)\s*[）)]/g;
const WECHAT_TTS_STATUS_REGEX = /\[\s*转线下\s*\]/gi;

function normalizeRemovedSegmentSpacing(value = '') {
    return String(value || '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([，。！？、；：,.!?;:])/g, '$1')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function parseWechatTranslationContent(value = '') {
    const displayText = String(value || '').trim();
    const translations = [];
    const speechText = normalizeRemovedSegmentSpacing(displayText.replace(
        WECHAT_TRANSLATION_REGEX,
        (_match, squareTranslation, fullwidthTranslation) => {
            const translation = String(squareTranslation ?? fullwidthTranslation ?? '').trim();
            if (translation) translations.push(translation);
            return '';
        }
    ));

    return {
        displayText,
        speechText,
        translationText: translations.join('\n')
    };
}

export function stripWechatTranslationContent(value = '') {
    return parseWechatTranslationContent(value).speechText;
}

export function parseWechatInnerThoughtContent(value = '') {
    const thoughts = [];
    const visibleContent = normalizeRemovedSegmentSpacing(String(value || '').replace(
        WECHAT_INNER_THOUGHT_REGEX,
        (_match, thought) => {
            const text = String(thought || '').trim();
            if (text) thoughts.push(text);
            return '';
        }
    ));

    return {
        visibleContent,
        innerThought: thoughts.join('\n')
    };
}

export function stripWechatTtsNonSpeechContent(value = '') {
    const parsedInnerThought = parseWechatInnerThoughtContent(value);
    return normalizeRemovedSegmentSpacing(
        stripWechatTranslationContent(parsedInnerThought.visibleContent)
            .replace(WECHAT_TTS_STATUS_REGEX, '')
    );
}

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

export function parseWechatVoiceContent(value = '') {
    const parsedInnerThought = parseWechatInnerThoughtContent(value);
    const voiceSource = parsedInnerThought.visibleContent;

    const voiceText = normalizeWechatVoiceText(voiceSource);
    const translated = parseWechatTranslationContent(voiceText);

    return {
        voiceText: translated.displayText,
        ttsText: translated.speechText,
        translationText: translated.translationText,
        innerThought: parsedInnerThought.innerThought
    };
}
