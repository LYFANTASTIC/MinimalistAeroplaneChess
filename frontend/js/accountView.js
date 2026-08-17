const accountNumberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const accountDateFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

const REASON_LABELS = {
    plane_defeated: '击落飞机',
    happy_collision: '欢乐碰撞'
};

export function formatAccountNumber(value) {
    const number = Number(value);
    return accountNumberFormatter.format(Number.isFinite(number) ? number : 0);
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? accountDateFormatter.format(date) : '时间未知';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function mergeHistoryItems(existing = [], incoming = []) {
    const byId = new Map(existing.map(item => [item.id, item]));
    incoming.forEach(item => byId.set(item.id, item));
    return Array.from(byId.values());
}

export function renderMatchHistory(items = []) {
    if (!items.length) return '<p class="history-empty">还没有对局记录，去和朋友开一局吧。</p>';
    return items.map(item => {
        const placement = item.placement ? `第 ${escapeHtml(item.placement)} 名` : '未结算';
        const mode = item.happyMode ? '欢乐模式' : '标准模式';
        return `<article class="history-row">
            <div><strong>${placement}</strong><span>${mode} · ${escapeHtml(item.pieceCount || 4)} 棋子</span></div>
            <div class="history-metrics"><span>击落 ${formatAccountNumber(item.planesDefeated)}</span><b>+${formatAccountNumber(item.accountPointsEarned)} 分</b></div>
            <time>${formatDate(item.startedAt)}</time>
        </article>`;
    }).join('');
}

export function renderPointsHistory(items = []) {
    if (!items.length) return '<p class="history-empty">还没有积分记录，对局中击落飞机后会显示在这里。</p>';
    return items.map(item => {
        const reason = REASON_LABELS[item.reason] || '对局奖励';
        const amount = Number(item.amount) || 0;
        return `<article class="history-row points-row">
            <div><strong>${escapeHtml(reason)}</strong><span>余额 ${formatAccountNumber(item.balanceAfter)}</span></div>
            <b class="points-amount ${amount < 0 ? 'is-negative' : ''}">${amount >= 0 ? '+' : ''}${formatAccountNumber(amount)}</b>
            <time>${formatDate(item.createdAt)}</time>
        </article>`;
    }).join('');
}
