const ACCOUNT_PATH = '/account';

function getCurrentReturnPath() {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

function redirectToLogin(reason = '') {
    const params = new URLSearchParams({ returnTo: getCurrentReturnPath() });
    if (reason) params.set('reason', reason);
    window.location.replace(`${ACCOUNT_PATH}?${params.toString()}`);
}

function showConnectionFallback() {
    document.body.replaceChildren();
    const fallback = document.createElement('main');
    fallback.className = 'auth-guard-fallback';
    fallback.setAttribute('role', 'alert');

    const title = document.createElement('h1');
    title.textContent = '暂时无法连接服务器';
    const description = document.createElement('p');
    description.textContent = '请检查网络后重试，你当前的页面地址不会丢失。';
    const actions = document.createElement('div');
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = '重新连接';
    retryButton.addEventListener('click', () => window.location.reload());
    const loginLink = document.createElement('a');
    loginLink.href = `${ACCOUNT_PATH}?returnTo=${encodeURIComponent(getCurrentReturnPath())}`;
    loginLink.textContent = '返回登录';

    actions.append(retryButton, loginLink);
    fallback.append(title, description, actions);
    document.body.appendChild(fallback);
    document.documentElement.classList.remove('auth-pending');
}

export async function requireAuthenticatedUser() {
    if (window.location.protocol === 'file:') {
        redirectToLogin('static-preview');
        return new Promise(() => {});
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch('/api/auth/me', {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal
        });

        if (response.status === 401) {
            redirectToLogin('login-required');
            return new Promise(() => {});
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data?.user) throw new Error('登录信息无效');

        window.currentAuthUser = data.user;
        document.documentElement.classList.remove('auth-pending');
        return data.user;
    } catch (error) {
        if (error?.name !== 'AbortError') console.error('登录状态检查失败:', error);
        showConnectionFallback();
        return new Promise(() => {});
    } finally {
        clearTimeout(timeout);
    }
}

export function handleAuthenticationExpired() {
    redirectToLogin('session-expired');
}
