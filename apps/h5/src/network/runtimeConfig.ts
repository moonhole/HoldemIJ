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

type DesktopBridgeNetwork = {
    apiBaseUrl?: string;
    wsUrl?: string;
};

function readDesktopBridgeNetwork(): DesktopBridgeNetwork | null {
    const host = globalThis as typeof globalThis & {
        desktopBridge?: {
            network?: DesktopBridgeNetwork;
        };
    };
    const network = host.desktopBridge?.network;
    if (!network) {
        return null;
    }
    return network;
}

const desktopNetwork = readDesktopBridgeNetwork();
const apiBase = trimTrailingSlash(desktopNetwork?.apiBaseUrl?.trim() || readEnv('VITE_API_BASE_URL'));
const wsBase = (desktopNetwork?.wsUrl?.trim() || readEnv('VITE_WS_URL')).trim();

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
