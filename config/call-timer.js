export function formatCallDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const sec = String(total % 60).padStart(2, '0');
    const min = String(Math.floor(total / 60) % 60).padStart(2, '0');
    return total >= 3600 ? `${Math.floor(total / 3600)}:${min}:${sec}` : `${min}:${sec}`;
}

// Keep the original element: a later call may reuse its ID.
export function startCallTimer(element, onTick, now = () => performance.now(), initialSeconds = 0) {
    const startedAt = now();
    const initial = Math.max(0, Math.floor(Number(initialSeconds) || 0));
    let elapsed = initial;
    if (element?.isConnected) {
        element.textContent = formatCallDuration(elapsed);
        onTick(elapsed);
    }
    const timer = setInterval(() => {
        if (!element?.isConnected) {
            clearInterval(timer);
            return;
        }
        elapsed = Math.max(elapsed, initial + Math.floor((now() - startedAt) / 1000));
        onTick(elapsed);
        element.textContent = formatCallDuration(elapsed);
    }, 1000);
    return timer;
}
