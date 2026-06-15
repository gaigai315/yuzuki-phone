export const PHONE_CONTEXT_LIMIT_KEY = 'phone-context-limit';
export const PHONE_CONTEXT_LIMIT_INITIAL_VALUE = 20;
export const PHONE_CONTEXT_LIMIT_MAX = 9999;

export function normalizePhoneContextLimit(value, fallback = PHONE_CONTEXT_LIMIT_INITIAL_VALUE) {
    const parsed = Number.parseInt(value, 10);
    const safeFallback = Number.isFinite(Number.parseInt(fallback, 10))
        ? Number.parseInt(fallback, 10)
        : PHONE_CONTEXT_LIMIT_INITIAL_VALUE;
    const rawLimit = Number.isFinite(parsed) ? parsed : safeFallback;
    return Math.max(0, Math.min(PHONE_CONTEXT_LIMIT_MAX, rawLimit));
}

export function readPhoneContextLimit(storage) {
    const raw = storage?.get?.(PHONE_CONTEXT_LIMIT_KEY);
    return normalizePhoneContextLimit(raw);
}

export async function ensurePhoneContextLimitSetting(storage) {
    const raw = storage?.get?.(PHONE_CONTEXT_LIMIT_KEY, undefined);
    if (raw !== undefined && raw !== null && raw !== '') return normalizePhoneContextLimit(raw);
    const initialValue = normalizePhoneContextLimit(PHONE_CONTEXT_LIMIT_INITIAL_VALUE);
    await storage?.set?.(PHONE_CONTEXT_LIMIT_KEY, initialValue);
    return initialValue;
}
