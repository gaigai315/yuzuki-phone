const YUZUKI_CLEAR_FLORAL_ASSETS = Object.freeze({
    quickReply: new URL('./themes/yuzuki-clear-floral/quick-reply.png', import.meta.url).href,
    regenerate: new URL('./themes/yuzuki-clear-floral/regenerate.png', import.meta.url).href,
    emoji: new URL('./themes/yuzuki-clear-floral/emoji.png', import.meta.url).href,
    more: new URL('./themes/yuzuki-clear-floral/more.png', import.meta.url).href,
    send: new URL('./themes/yuzuki-clear-floral/send.png', import.meta.url).href,
    stop: new URL('./themes/yuzuki-clear-floral/stop.png', import.meta.url).href,
    leftBubbleDecoration: new URL('./themes/yuzuki-clear-floral/left-bubble-decoration.png', import.meta.url).href,
    rightBubble: new URL('./themes/yuzuki-clear-floral/right-bubble.png', import.meta.url).href
});

export const YUZUKI_CLEAR_FLORAL_CHAT_STYLE_ID = 'builtin_yuzuki_clear_floral';
export const WECHAT_NATIVE_CHAT_STYLE_ID = 'builtin_wechat_native';
export const DEFAULT_WECHAT_CHAT_STYLE_ID = WECHAT_NATIVE_CHAT_STYLE_ID;

const YUZUKI_CLEAR_FLORAL_CHAT_CSS = `
#phone-panel-content .phone-screen .wechat-app:has(.chat-room) {
    --yzp-chat-ink: #27313b;
    --yzp-icon-quick-reply: url("${YUZUKI_CLEAR_FLORAL_ASSETS.quickReply}");
    --yzp-icon-regenerate: url("${YUZUKI_CLEAR_FLORAL_ASSETS.regenerate}");
    --yzp-icon-emoji: url("${YUZUKI_CLEAR_FLORAL_ASSETS.emoji}");
    --yzp-icon-more: url("${YUZUKI_CLEAR_FLORAL_ASSETS.more}");
    --yzp-icon-send: url("${YUZUKI_CLEAR_FLORAL_ASSETS.send}");
    --yzp-icon-stop: url("${YUZUKI_CLEAR_FLORAL_ASSETS.stop}");
}

#phone-panel-content .phone-screen .wechat-app:has(.chat-room) .wechat-header {
    background: rgba(239, 247, 252, 0.24) !important;
    -webkit-backdrop-filter: blur(18px) saturate(145%) !important;
    backdrop-filter: blur(18px) saturate(145%) !important;
    border-bottom: 1px solid rgba(255, 255, 255, 0.58) !important;
    box-shadow: 0 1px 8px rgba(91, 122, 150, 0.08) !important;
}

#phone-panel-content .phone-screen .wechat-app:has(.chat-room) .wechat-header-title {
    color: var(--yzp-chat-ink) !important;
    font-size: 16px !important;
    font-weight: 500 !important;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.78);
}

#phone-panel-content .phone-screen .wechat-app:has(.chat-room) .wechat-back-btn,
#phone-panel-content .phone-screen .wechat-app:has(.chat-room) .wechat-header-btn {
    color: #263746 !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .chat-messages {
    padding: 14px 10px 8px !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .chat-message {
    margin-bottom: 13px !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-content {
    max-width: 74% !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-avatar {
    width: 36px !important;
    height: 36px !important;
    border: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    border-radius: 50% !important;
    background: rgba(255, 255, 255, 0.56) !important;
    box-shadow:
        0 2px 7px rgba(69, 99, 126, 0.16),
        0 0 0 1px rgba(164, 197, 222, 0.16) !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-avatar img {
    border-radius: 50% !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-left .message-avatar {
    margin-right: 8px !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-right .message-avatar {
    margin-left: 8px !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-text {
    min-height: 36px;
    padding: 9px 14px 11px !important;
    box-sizing: border-box;
    border: 0 !important;
    border-radius: 14px !important;
    color: var(--yzp-chat-ink) !important;
    font-size: 14px !important;
    font-weight: 400 !important;
    line-height: 1.55 !important;
    text-shadow: 0 1px 1px rgba(255, 255, 255, 0.48);
    box-shadow: none !important;
    background: transparent !important;
    isolation: isolate;
    z-index: 0;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-text::after {
    content: "" !important;
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    pointer-events: none;
    z-index: -1;
    border-style: solid;
    border-color: transparent;
    border-image-repeat: stretch;
    border-image-outset: 0;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-left .message-text {
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(239, 244, 249, 0.94)) !important;
    border: 1px solid rgba(255, 255, 255, 0.86) !important;
    box-shadow: 0 1px 3px rgba(92, 116, 137, 0.08) !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-left .message-text::after {
    inset: auto -6px -5px auto;
    width: 18px;
    height: 18px;
    border: 0;
    border-image: none;
    background-image: url("${YUZUKI_CLEAR_FLORAL_ASSETS.leftBubbleDecoration}");
    background-repeat: no-repeat;
    background-size: 139px 40px;
    background-position: right bottom;
    z-index: 1;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-right .message-text::after {
    border-width: 8px 19px 13px 8px;
    border-image-source: url("${YUZUKI_CLEAR_FLORAL_ASSETS.rightBubble}");
    border-image-slice: 65 190 120 70 fill;
    border-image-width: 8px 19px 13px 8px;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-text::before {
    content: none !important;
    display: none !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-left .message-text::before {
    content: "" !important;
    display: block !important;
    position: absolute;
    left: -7px;
    top: 11px;
    width: 9px;
    height: 14px;
    border: 0;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 246, 250, 0.96)) !important;
    clip-path: polygon(100% 0, 100% 100%, 0 50%);
    filter: drop-shadow(-0.5px 0 0 rgba(186, 201, 214, 0.28));
    pointer-events: none;
    z-index: 0;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-sender {
    margin: 0 0 3px 4px !important;
    color: rgba(63, 91, 114, 0.78) !important;
    font-size: 10px !important;
    text-shadow: 0 1px 1px rgba(255, 255, 255, 0.72);
}

#phone-panel-content .phone-screen .wechat-app .chat-room .message-time-divider {
    margin: 11px 0 15px !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room .time-divider-text {
    padding: 2px 8px !important;
    border-radius: 10px;
    color: rgba(76, 93, 108, 0.52) !important;
    background: rgba(255, 255, 255, 0.18);
    -webkit-backdrop-filter: blur(5px);
    backdrop-filter: blur(5px);
    text-shadow: 0 1px 1px rgba(255, 255, 255, 0.72);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #quick-reply-btn,
#phone-panel-content .phone-screen .wechat-app .chat-room #regenerate-btn,
#phone-panel-content .phone-screen .wechat-app .chat-room #emoji-btn,
#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn {
    position: relative !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room #quick-reply-btn > svg,
#phone-panel-content .phone-screen .wechat-app .chat-room #quick-reply-btn > i,
#phone-panel-content .phone-screen .wechat-app .chat-room #regenerate-btn > svg,
#phone-panel-content .phone-screen .wechat-app .chat-room #regenerate-btn > i,
#phone-panel-content .phone-screen .wechat-app .chat-room #emoji-btn > svg,
#phone-panel-content .phone-screen .wechat-app .chat-room #emoji-btn > i,
#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn > svg,
#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn > i {
    opacity: 0 !important;
    visibility: hidden !important;
}

#phone-panel-content .phone-screen .wechat-app .chat-room #quick-reply-btn::after,
#phone-panel-content .phone-screen .wechat-app .chat-room #regenerate-btn::after,
#phone-panel-content .phone-screen .wechat-app .chat-room #emoji-btn::after,
#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 24px;
    height: 24px;
    transform: translate(-50%, -50%);
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    pointer-events: none;
    z-index: 3;
}

#phone-panel-content .phone-screen .wechat-app .chat-room #quick-reply-btn::after {
    background-image: var(--yzp-icon-quick-reply);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #regenerate-btn::after {
    background-image: var(--yzp-icon-regenerate);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #emoji-btn::after {
    background-image: var(--yzp-icon-emoji);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn[data-mode="more"]::after {
    background-image: var(--yzp-icon-more);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn[data-mode="send"]::after {
    background-image: var(--yzp-icon-send);
}

#phone-panel-content .phone-screen .wechat-app .chat-room #send-btn[data-mode="stop"]::after {
    background-image: var(--yzp-icon-stop);
}

@media (max-width: 380px) {
    #phone-panel-content .phone-screen .wechat-app .chat-room .message-content {
        max-width: 72% !important;
    }

    #phone-panel-content .phone-screen .wechat-app .chat-room .message-text {
        padding: 8px 12px 10px !important;
        font-size: 13px !important;
    }
}
`.trim();

export function getBuiltinWechatChatStyleProfiles() {
    return [
        {
            id: WECHAT_NATIVE_CHAT_STYLE_ID,
            name: '微信默认样式',
            css: '',
            builtin: true
        },
        {
            id: YUZUKI_CLEAR_FLORAL_CHAT_STYLE_ID,
            name: 'yuzuki_清透花语',
            css: YUZUKI_CLEAR_FLORAL_CHAT_CSS,
            builtin: true
        }
    ];
}
