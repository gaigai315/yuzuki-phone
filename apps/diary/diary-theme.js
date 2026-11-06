import { normalizePhoneHexColor } from '../../config/phone-colors.js';

export const DIARY_TEXT_COLOR_DEFAULT = '#000000';
// 原暖白纸张叠加在浅灰底色上的可见颜色，改为不透明底色。
export const DIARY_PAPER_COLOR_DEFAULT = '#FDF9F0';
export const DIARY_TEXT_COLOR_KEY = 'global_diary_text_color';
export const DIARY_PAPER_COLOR_KEY = 'global_diary_paper_color';

export function readDiaryAppearance(storage) {
    return {
        textColor: normalizePhoneHexColor(storage?.get(DIARY_TEXT_COLOR_KEY), DIARY_TEXT_COLOR_DEFAULT),
        paperColor: normalizePhoneHexColor(storage?.get(DIARY_PAPER_COLOR_KEY), DIARY_PAPER_COLOR_DEFAULT)
    };
}
