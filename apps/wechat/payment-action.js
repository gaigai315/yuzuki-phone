// Shared by online replies and story-to-phone synchronization.
export function parseWechatPaymentAction(value) {
    const match = String(value || '').trim().match(/^\[(领取转账|收款|领取(?:拼手气|均分|平均|群)?红包|退回转账|退回红包)\s*(?:[¥￥]\s*(\d+(?:\.\d+)?))?\](?:\s*[（(]\s*([^）)]*)\s*[）)])?$/);
    if (!match) return null;
    const marker = match[1].trim();
    const amount = match[2] ? Number.parseFloat(match[2]).toFixed(2) : '';
    return {
        type: 'payment_action', action: marker.includes('退回') ? 'refund' : 'accept',
        targetType: marker.includes('红包') ? 'redpacket' : 'transfer',
        claimMode: marker.includes('拼手气') ? 'lucky' : /均分|平均|群/.test(marker) ? 'average' : 'single',
        amount, note: String(match[3] || '').trim(), content: `[${marker}${amount ? `¥${amount}` : ''}]`
    };
}


export function captureWechatPaymentState(message = {}) {
    const fields = ['status', 'claims', 'packetClaimCount', 'claimedAmount', 'remainingAmount', 'lastClaimedBy',
        'lastClaimedAmount', 'paymentHandledBy', 'paymentHandledAt'];
    return Object.fromEntries(fields.map(key => [key, message[key] === undefined ? null
        : JSON.parse(JSON.stringify(message[key]))]));
}
