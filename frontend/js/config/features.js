// 道具实现完整保留；恢复时必须同时打开浏览器端和服务端开关。
export const ITEMS_ENABLED = false;

export function normalizeItemSettings(settings = {}) {
    return {
        ...settings,
        skillMode: ITEMS_ENABLED && settings.skillMode === true
    };
}

export function applyItemsFeatureState(root = document) {
    if (ITEMS_ENABLED || !root?.querySelectorAll) return;
    root.querySelectorAll('[data-items-feature]').forEach(node => {
        node.hidden = true;
        node.setAttribute?.('aria-hidden', 'true');
        node.querySelectorAll?.('input, button, select').forEach(control => {
            if ('checked' in control) control.checked = false;
            control.disabled = true;
        });
    });
}
