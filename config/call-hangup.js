export const CALL_HANGUP_RULE = '【主动挂断规则】如果当前角色认为话题已经结束，可以在最后一句回复末尾另起一行输出“已挂断”（放在 <wechat> 标签内），表示角色主动结束本次通话。未决定挂断时不要输出此标记，也不要替用户决定挂断。';

export function parseCallHangupReply(value) {
    const text = String(value || '').trim();
    const marker = /(?:\[已挂断\]|【已挂断】|已挂断)[。.!！]?\s*$/;
    return { ended: marker.test(text), text: text.replace(marker, '').trim() };
}
