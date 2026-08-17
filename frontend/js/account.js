const api = {
    async request(path, options = {}) {
        if (window.location.protocol === 'file:') {
            throw new Error('当前为本地静态预览，登录注册需要启动完整项目后使用');
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(path, {
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options,
                signal: controller.signal
            });
            const data = await response.json().catch(() => ({ success: false, message: '服务器返回了无法识别的内容' }));
            if (!response.ok) {
                const error = new Error(data.message || '操作失败，请稍后重试');
                error.status = response.status;
                throw error;
            }
            return data;
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('连接超时，请检查网络后重试');
            if (error instanceof TypeError) throw new Error('暂时无法连接服务器，请稍后重试');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    },
    me() { return this.request('/api/auth/me'); },
    login(payload) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }); },
    register(payload) { return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }); },
    logout() { return this.request('/api/auth/logout', { method: 'POST', body: '{}' }); },
    updateProfile(payload) { return this.request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(payload) }); },
    changePassword(payload) { return this.request('/api/auth/password', { method: 'PUT', body: JSON.stringify(payload) }); }
};

function getSafeReturnTo() {
    const candidate = new URLSearchParams(window.location.search).get('returnTo');
    if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return null;
    try {
        const target = new URL(candidate, window.location.origin);
        if (target.origin !== window.location.origin || target.pathname === '/account' || target.pathname === '/account.html') {
            return null;
        }
        return `${target.pathname}${target.search}${target.hash}`;
    } catch (error) {
        return null;
    }
}

function continueAfterAuthentication(user) {
    savePlayerNickname(user.displayName);
    const returnTo = getSafeReturnTo();
    if (returnTo) {
        window.location.replace(returnTo);
        return true;
    }
    renderProfile(user);
    return false;
}

const elements = {
    authView: document.getElementById('authView'),
    profileView: document.getElementById('profileView'),
    loginTab: document.getElementById('loginTab'),
    registerTab: document.getElementById('registerTab'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    authTitle: document.getElementById('authTitle'),
    authKicker: document.getElementById('authKicker'),
    authMessage: document.getElementById('authMessage'),
    profileMessage: document.getElementById('profileMessage'),
    passwordMessage: document.getElementById('passwordMessage')
};

function showMessage(element, message = '', type = 'error') {
    if (!element) return;
    element.textContent = message;
    element.className = `form-message${message ? ` is-visible is-${type}` : ''}`;
}

function setLoading(form, loading) {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = loading;
    if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
    button.innerHTML = loading ? '<span>请稍候…</span>' : button.dataset.originalText;
}

function switchTab(tab) {
    const isLogin = tab === 'login';
    elements.loginTab.classList.toggle('is-active', isLogin);
    elements.registerTab.classList.toggle('is-active', !isLogin);
    elements.loginTab.setAttribute('aria-selected', String(isLogin));
    elements.registerTab.setAttribute('aria-selected', String(!isLogin));
    elements.loginForm.hidden = !isLogin;
    elements.registerForm.hidden = isLogin;
    elements.authTitle.textContent = isLogin ? '欢迎回来' : '创建你的账号';
    elements.authKicker.textContent = isLogin ? '继续你的飞行旅程' : '第一次起飞，从这里开始';
    showMessage(elements.authMessage);
}

function savePlayerNickname(displayName) {
    try {
        localStorage.setItem('aeroplaneChess_playerNickname', displayName);
    } catch (error) {
        // 浏览器禁用本地存储时不影响账户功能。
    }
}

function renderProfile(user) {
    elements.authView.hidden = true;
    elements.profileView.hidden = false;
    document.getElementById('profileDisplayName').textContent = user.displayName;
    document.getElementById('profileUsername').textContent = `@${user.username}`;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileCreatedAt').textContent = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date(user.createdAt));
    document.getElementById('profileAvatar').textContent = Array.from(user.displayName)[0] || '飞';
    document.getElementById('displayNameInput').value = user.displayName;
    savePlayerNickname(user.displayName);
}

function renderAuth() {
    elements.profileView.hidden = true;
    elements.authView.hidden = false;
    switchTab('login');
}

elements.loginTab.addEventListener('click', () => switchTab('login'));
elements.registerTab.addEventListener('click', () => switchTab('register'));
document.querySelectorAll('[data-switch-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.switchTab));
});

document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? '隐藏' : '显示';
        button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    });
});

document.getElementById('registerPassword').addEventListener('input', event => {
    const password = event.target.value;
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) strength++;
    if (/[^A-Za-z\d]/.test(password) && password.length >= 10) strength++;
    document.querySelector('.password-meter').dataset.strength = String(strength);
});

elements.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(elements.authMessage);
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!identifier || !password) {
        showMessage(elements.authMessage, '请输入账号和密码');
        return;
    }
    setLoading(elements.loginForm, true);
    try {
        const data = await api.login({ identifier, password, remember: document.getElementById('rememberMe').checked });
        continueAfterAuthentication(data.user);
    } catch (error) {
        showMessage(elements.authMessage, error.message);
    } finally {
        setLoading(elements.loginForm, false);
    }
});

elements.registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(elements.authMessage);
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    if (!username || !email || !password || !confirmPassword) {
        showMessage(elements.authMessage, '请完整填写注册信息');
        return;
    }
    if (password !== confirmPassword) {
        showMessage(elements.authMessage, '两次输入的密码不一致');
        return;
    }
    if (!document.getElementById('registerAgreement').checked) {
        showMessage(elements.authMessage, '请先确认账号使用说明');
        return;
    }
    setLoading(elements.registerForm, true);
    try {
        const data = await api.register({ username, email, password });
        continueAfterAuthentication(data.user);
    } catch (error) {
        showMessage(elements.authMessage, error.message);
    } finally {
        setLoading(elements.registerForm, false);
    }
});

document.querySelectorAll('[data-profile-panel]').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('[data-profile-panel]').forEach(item => item.classList.toggle('is-active', item === button));
        document.getElementById('basicProfilePanel').hidden = button.dataset.profilePanel !== 'basicProfilePanel';
        document.getElementById('passwordPanel').hidden = button.dataset.profilePanel !== 'passwordPanel';
    });
});

document.getElementById('basicProfilePanel').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const displayName = document.getElementById('displayNameInput').value.trim();
    showMessage(elements.profileMessage);
    setLoading(form, true);
    try {
        const data = await api.updateProfile({ displayName });
        renderProfile(data.user);
        showMessage(elements.profileMessage, '个人资料已保存', 'success');
    } catch (error) {
        if (error.status === 401) {
            renderAuth();
            showMessage(elements.authMessage, '登录状态已失效，请重新登录');
            return;
        }
        showMessage(elements.profileMessage, error.message);
    } finally {
        setLoading(form, false);
    }
});

document.getElementById('passwordPanel').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    showMessage(elements.passwordMessage);
    setLoading(form, true);
    try {
        await api.changePassword({ currentPassword, newPassword });
        form.reset();
        showMessage(elements.passwordMessage, '密码已更新，其他设备上的登录状态已失效', 'success');
    } catch (error) {
        if (error.status === 401) {
            renderAuth();
            showMessage(elements.authMessage, '登录状态已失效，请重新登录');
            return;
        }
        showMessage(elements.passwordMessage, error.message);
    } finally {
        setLoading(form, false);
    }
});

document.getElementById('logoutButton').addEventListener('click', async () => {
    try { await api.logout(); } catch (error) { /* 即使网络异常也返回登录界面。 */ }
    renderAuth();
});

async function initialize() {
    try {
        const data = await api.me();
        continueAfterAuthentication(data.user);
    } catch (error) {
        renderAuth();
        const reason = new URLSearchParams(window.location.search).get('reason');
        if (error.status && error.status !== 401) {
            showMessage(elements.authMessage, error.message);
        } else if (!error.status) {
            showMessage(elements.authMessage, error.message);
        } else if (reason === 'session-expired') {
            showMessage(elements.authMessage, '登录状态已失效，请重新登录');
        } else if (reason === 'login-required') {
            showMessage(elements.authMessage, '请先登录后再进入游戏');
        } else if (reason === 'static-preview') {
            showMessage(elements.authMessage, '登录功能需要通过本地项目地址访问');
        }
    }
}

initialize();
