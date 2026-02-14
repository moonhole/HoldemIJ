function readEnv(name: 'VITE_API_BASE_URL' | 'VITE_WS_URL'): string {
    const value = import.meta.env[name];
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function trimTrailingSlash(url: string): string {
    if (!url) {
        return '';
    }
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

const apiBase = trimTrailingSlash(readEnv('VITE_API_BASE_URL'));
const wsBase = readEnv('VITE_WS_URL');

export function resolveApiUrl(pathname: string): string {
    if (!pathname.startsWith('/')) {
        throw new Error(`resolveApiUrl expects leading slash, got: ${pathname}`);
    }
    if (!apiBase) {
        return pathname;
    }
    return `${apiBase}${pathname}`;
}

export function resolveWsUrl(defaultPath = '/ws'): string {
    if (wsBase) {
        return wsBase;
    }
    if (!defaultPath.startsWith('/')) {
        return defaultPath;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.host}${defaultPath}`;
}
