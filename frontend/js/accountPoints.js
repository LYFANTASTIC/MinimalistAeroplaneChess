const pointsFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function defaultNotify(message, status = 'pending') {
    if (typeof document === 'undefined') return;
    const toast = document.createElement('div');
    toast.className = `account-points-toast is-${status}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 250);
    }, 2200);
}

export function createAccountPointsTracker({ notify = defaultNotify } = {}) {
    const events = new Map();
    const matchPoints = new Map();
    let balance = null;

    function addEvent(data, status) {
        const amount = Number(data.amount);
        if (!data.idempotencyKey || !Number.isFinite(amount)) return null;
        const existing = events.get(data.idempotencyKey);
        if (existing) return existing;
        const event = { ...data, amount, status };
        events.set(data.idempotencyKey, event);
        const player = Number(data.player);
        matchPoints.set(player, Math.round(((matchPoints.get(player) || 0) + amount) * 100) / 100);
        return event;
    }

    return {
        handlePending(data) {
            const event = addEvent(data, 'pending');
            if (!event || event.status !== 'pending' || event._notified) return event;
            event._notified = true;
            notify(`账户积分 +${pointsFormatter.format(event.amount)}（同步中）`, 'pending');
            return event;
        },

        handleUpdated(data) {
            const event = addEvent(data, 'confirmed') || events.get(data.idempotencyKey);
            if (!event) return null;
            event.status = 'confirmed';
            event.balance = Number(data.balance);
            if (Number.isFinite(event.balance)) balance = event.balance;
            notify(`账户积分 +${pointsFormatter.format(event.amount)} 已到账`, 'confirmed');
            return event;
        },

        handleFailed(data) {
            const event = events.get(data.idempotencyKey);
            if (!event) return null;
            event.status = 'failed';
            notify('账户积分同步失败，将在结算时重试', 'failed');
            return event;
        },

        getBalance: () => balance,
        getEvent: idempotencyKey => events.get(idempotencyKey) || null,
        getMatchPoints: player => matchPoints.get(Number(player)) || 0,
        getAllMatchPoints: () => Object.fromEntries(matchPoints)
    };
}

export const accountPoints = createAccountPointsTracker();
