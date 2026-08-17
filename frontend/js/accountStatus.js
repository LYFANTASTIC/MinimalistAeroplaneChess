async function updateAccountStatus() {
    const link = document.getElementById('indexAccountLink');
    const avatar = document.getElementById('indexAccountAvatar');
    const hint = document.getElementById('indexAccountHint');
    const name = document.getElementById('indexAccountName');
    if (!link || !avatar || !hint || !name) return;

    try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.user) return;

        const firstCharacter = Array.from(data.user.displayName || data.user.username || '飞')[0];
        avatar.textContent = firstCharacter;
        avatar.classList.add('is-signed-in');
        hint.textContent = `@${data.user.username}`;
        name.textContent = data.user.displayName;
        link.setAttribute('aria-label', `进入 ${data.user.displayName} 的用户中心`);

        try {
            localStorage.setItem('aeroplaneChess_playerNickname', data.user.displayName);
        } catch (error) {
            // 本地存储不可用时不影响首页。
        }
    } catch (error) {
        // 后端未启动时保持访客状态，不阻塞游戏首页。
    }
}

updateAccountStatus();
