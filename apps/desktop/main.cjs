const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let mainWindow = null;
let gpuInfoWindow = null;
let perfLogStream = null;
let localServerState = null;
let quitInFlight = false;

const userDataOverride = process.env.ELECTRON_USER_DATA_DIR;
if (userDataOverride && userDataOverride.trim() !== '') {
    app.setPath('userData', path.resolve(process.cwd(), userDataOverride));
}

function resolvePerfLogPath() {
    const raw = process.env.ELECTRON_PERF_LOG_FILE;
    if (!raw || raw.trim() === '') {
        return null;
    }
    if (path.isAbsolute(raw)) {
        return raw;
    }
    return path.resolve(process.cwd(), raw);
}

function ensurePerfLogStream() {
    const perfLogPath = resolvePerfLogPath();
    if (!perfLogPath) {
        return null;
    }
    if (perfLogStream) {
        return perfLogStream;
    }
    fs.mkdirSync(path.dirname(perfLogPath), { recursive: true });
    perfLogStream = fs.createWriteStream(perfLogPath, { flags: 'a' });
    return perfLogStream;
}

function appendPerfSample(sample) {
    const stream = ensurePerfLogStream();
    if (!stream) {
        return;
    }
    stream.write(`${JSON.stringify(sample)}${os.EOL}`);
}

function closePerfLogStream() {
    if (!perfLogStream) {
        return;
    }
    perfLogStream.end();
    perfLogStream = null;
}

function parseBooleanEnv(rawValue, fallback) {
    if (!rawValue || rawValue.trim() === '') {
        return fallback;
    }
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

function parsePositiveIntEnv(rawValue, fallback) {
    if (!rawValue || rawValue.trim() === '') {
        return fallback;
    }
    const parsed = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function shouldManageLocalServer() {
    return parseBooleanEnv(process.env.ELECTRON_LOCAL_SERVER, true);
}

function shouldReuseExistingLocalServer() {
    return parseBooleanEnv(process.env.ELECTRON_LOCAL_SERVER_REUSE_EXISTING, false);
}

function shouldPipeLocalServerLogs() {
    const defaultValue = !app.isPackaged;
    return parseBooleanEnv(process.env.ELECTRON_LOCAL_SERVER_LOGS, defaultValue);
}

function resolveLocalServerHost() {
    const host = process.env.ELECTRON_LOCAL_SERVER_HOST;
    if (!host || host.trim() === '') {
        return '127.0.0.1';
    }
    return host.trim();
}

function resolveLocalServerPort() {
    return parsePositiveIntEnv(process.env.ELECTRON_LOCAL_SERVER_PORT, 18080);
}

function resolveLocalServerAddress() {
    return `${resolveLocalServerHost()}:${resolveLocalServerPort()}`;
}

function resolveLocalServerHealthUrl() {
    return `http://${resolveLocalServerAddress()}/health`;
}

function toAbsolutePath(rawPath) {
    if (path.isAbsolute(rawPath)) {
        return rawPath;
    }
    return path.resolve(process.cwd(), rawPath);
}

function resolveLocalDatabasePath() {
    const configured = process.env.LOCAL_DATABASE_PATH;
    if (configured && configured.trim() !== '') {
        return toAbsolutePath(configured.trim());
    }
    return path.join(app.getPath('userData'), 'holdem_local.db');
}

function resolvePackagedServerRuntimeDir() {
    return path.join(process.resourcesPath, 'local-server');
}

function resolveLocalServerBinaryName() {
    return process.platform === 'win32' ? 'holdem-server.exe' : 'holdem-server';
}

function resolveDevServerRuntimeDir() {
    return path.join(__dirname, 'local-server-dist');
}

function parseEndpointHostPort(endpoint) {
    if (!endpoint || endpoint.trim() === '') {
        return null;
    }
    const raw = endpoint.trim();
    if (raw.startsWith('[')) {
        const idx = raw.lastIndexOf(']:');
        if (idx <= 0) {
            return null;
        }
        const host = raw.slice(1, idx).toLowerCase();
        const port = Number.parseInt(raw.slice(idx + 2), 10);
        if (!Number.isFinite(port) || port <= 0) {
            return null;
        }
        return { host, port };
    }

    const idx = raw.lastIndexOf(':');
    if (idx <= 0) {
        return null;
    }
    const host = raw.slice(0, idx).toLowerCase();
    const port = Number.parseInt(raw.slice(idx + 1), 10);
    if (!Number.isFinite(port) || port <= 0) {
        return null;
    }
    return { host, port };
}

function isLoopbackHost(host) {
    const normalized = (host || '').toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function hostMatchesForPort(targetHost, listeningHost) {
    const target = (targetHost || '').toLowerCase();
    const listening = (listeningHost || '').toLowerCase();
    if (!target || !listening) {
        return false;
    }
    if (target === listening) {
        return true;
    }
    if (isLoopbackHost(target)) {
        return listening === '127.0.0.1' || listening === '::1' || listening === '0.0.0.0' || listening === '::';
    }
    return false;
}

function listListeningPidsByPort(host, port) {
    if (!Number.isFinite(port) || port <= 0) {
        return [];
    }

    if (process.platform === 'win32') {
        try {
            const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
                encoding: 'utf8',
                windowsHide: true,
            });
            const pids = new Set();
            for (const line of output.split(/\r?\n/)) {
                const match = line.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
                if (!match) {
                    continue;
                }
                const endpoint = parseEndpointHostPort(match[1]);
                if (!endpoint) {
                    continue;
                }
                if (endpoint.port !== port) {
                    continue;
                }
                if (!hostMatchesForPort(host, endpoint.host)) {
                    continue;
                }
                const pid = Number.parseInt(match[2], 10);
                if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) {
                    continue;
                }
                pids.add(pid);
            }
            return Array.from(pids);
        } catch {
            return [];
        }
    }

    return [];
}

function resolveManagedServerPidFilePath() {
    return path.join(app.getPath('userData'), 'local-server.pid');
}

function readManagedServerPidFromFile() {
    try {
        const raw = fs.readFileSync(resolveManagedServerPidFilePath(), 'utf8').trim();
        const pid = Number.parseInt(raw, 10);
        if (!Number.isFinite(pid) || pid <= 0) {
            return null;
        }
        return pid;
    } catch {
        return null;
    }
}

function writeManagedServerPidToFile(pid) {
    if (!Number.isFinite(pid) || pid <= 0) {
        return;
    }
    const pidFile = resolveManagedServerPidFilePath();
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(pid), 'utf8');
}

function clearManagedServerPidFile() {
    try {
        fs.rmSync(resolveManagedServerPidFilePath(), { force: true });
    } catch {
        // Ignore pid file cleanup failures.
    }
}

function isProcessRunning(pid) {
    if (!Number.isFinite(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function resolveLocalServerCommand() {
    const overrideBinary = process.env.ELECTRON_LOCAL_SERVER_BINARY;
    if (overrideBinary && overrideBinary.trim() !== '') {
        const commandPath = toAbsolutePath(overrideBinary.trim());
        return {
            source: 'env-override',
            command: commandPath,
            args: [],
            cwd: path.dirname(commandPath),
        };
    }

    const binaryName = resolveLocalServerBinaryName();

    if (app.isPackaged) {
        const runtimeDir = resolvePackagedServerRuntimeDir();
        return {
            source: 'packaged-binary',
            command: path.join(runtimeDir, 'bin', binaryName),
            args: [],
            cwd: runtimeDir,
        };
    }

    const devRuntimeDir = resolveDevServerRuntimeDir();
    const devBinaryPath = path.join(devRuntimeDir, 'bin', binaryName);
    if (fs.existsSync(devBinaryPath)) {
        return {
            source: 'dev-binary',
            command: devBinaryPath,
            args: [],
            cwd: devRuntimeDir,
        };
    }

    const repoRoot = path.resolve(__dirname, '..', '..');
    const goBinary = process.env.ELECTRON_GO_BINARY && process.env.ELECTRON_GO_BINARY.trim() !== ''
        ? process.env.ELECTRON_GO_BINARY.trim()
        : 'go';
    return {
        source: 'go-run',
        command: goBinary,
        args: ['run', '.'],
        cwd: path.join(repoRoot, 'apps', 'server'),
    };
}

function buildLocalServerEnv() {
    const env = { ...process.env };
    if (!env.AUTH_MODE || env.AUTH_MODE.trim() === '') {
        env.AUTH_MODE = 'local';
    }
    if (!env.SERVER_ADDR || env.SERVER_ADDR.trim() === '') {
        env.SERVER_ADDR = resolveLocalServerAddress();
    }
    if (!env.LOCAL_DATABASE_PATH || env.LOCAL_DATABASE_PATH.trim() === '') {
        env.LOCAL_DATABASE_PATH = resolveLocalDatabasePath();
    }
    return env;
}

function attachLocalServerLogs(childProcess) {
    if (!shouldPipeLocalServerLogs()) {
        return;
    }
    if (childProcess.stdout) {
        childProcess.stdout.on('data', (chunk) => {
            process.stdout.write(`[local-server] ${chunk.toString()}`);
        });
    }
    if (childProcess.stderr) {
        childProcess.stderr.on('data', (chunk) => {
            process.stderr.write(`[local-server] ${chunk.toString()}`);
        });
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function fetchHealthWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function isHealthReady(healthUrl) {
    try {
        const response = await fetchHealthWithTimeout(healthUrl, 700);
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForHealthReady(healthUrl, timeoutMs, intervalMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
        if (await isHealthReady(healthUrl)) {
            return true;
        }
        await sleep(intervalMs);
    }
    return false;
}

function hasChildExited(childProcess) {
    return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function waitForChildExit(childProcess, timeoutMs) {
    return new Promise((resolve) => {
        if (hasChildExited(childProcess)) {
            resolve(true);
            return;
        }
        const timeout = setTimeout(() => {
            childProcess.off('exit', onExit);
            resolve(hasChildExited(childProcess));
        }, timeoutMs);
        const onExit = () => {
            clearTimeout(timeout);
            resolve(true);
        };
        childProcess.once('exit', onExit);
    });
}

function forceKillProcessTree(pid) {
    if (!Number.isFinite(pid) || pid <= 0) {
        return;
    }
    if (process.platform === 'win32') {
        try {
            const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
                stdio: 'ignore',
                windowsHide: true,
            });
            killer.unref();
        } catch {
            // Ignore force-kill failures.
        }
        return;
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Ignore force-kill failures.
    }
}

async function cleanupStaleManagedLocalServer() {
    const stalePid = readManagedServerPidFromFile();
    if (!stalePid) {
        return;
    }
    if (!isProcessRunning(stalePid)) {
        clearManagedServerPidFile();
        return;
    }
    console.warn(`[desktop] Found stale managed local server pid=${stalePid}, terminating...`);
    forceKillProcessTree(stalePid);
    await sleep(400);
    clearManagedServerPidFile();
}

async function cleanupExistingLocalServerOnConfiguredPort() {
    const host = resolveLocalServerHost();
    const port = resolveLocalServerPort();
    const pids = listListeningPidsByPort(host, port);
    if (pids.length === 0) {
        return false;
    }
    console.warn(`[desktop] Found existing listener(s) on ${host}:${port}, terminating pid(s): ${pids.join(', ')}`);
    for (const pid of pids) {
        forceKillProcessTree(pid);
    }
    await sleep(600);
    return true;
}

async function stopManagedLocalServer() {
    const state = localServerState;
    if (!state || state.mode !== 'managed') {
        clearManagedServerPidFile();
        return;
    }
    if (state.stopPromise) {
        await state.stopPromise;
        return;
    }

    state.stopPromise = (async () => {
        const child = state.child;
        if (!child || hasChildExited(child)) {
            clearManagedServerPidFile();
            return;
        }
        if (process.platform === 'win32') {
            forceKillProcessTree(child.pid);
            await waitForChildExit(child, 1500);
            return;
        }
        try {
            child.kill('SIGTERM');
        } catch {
            // Ignore graceful kill failures.
        }

        const exitedGracefully = await waitForChildExit(child, 3000);
        if (!exitedGracefully) {
            forceKillProcessTree(child.pid);
            await waitForChildExit(child, 1500);
        }
    })();

    try {
        await state.stopPromise;
    } finally {
        clearManagedServerPidFile();
        if (localServerState === state) {
            localServerState = null;
        }
    }
}

async function ensureLocalServerReady() {
    if (!shouldManageLocalServer()) {
        return;
    }

    const healthUrl = resolveLocalServerHealthUrl();
    const existingReady = await isHealthReady(healthUrl);
    if (existingReady) {
        if (shouldReuseExistingLocalServer()) {
            localServerState = {
                mode: 'external',
                healthUrl,
            };
            console.log(`[desktop] Reusing existing server: ${healthUrl}`);
            return;
        }
        const cleaned = await cleanupExistingLocalServerOnConfiguredPort();
        if (!cleaned || (await isHealthReady(healthUrl))) {
            throw new Error(
                `Found existing service on ${healthUrl}. Stop it first or set ELECTRON_LOCAL_SERVER_REUSE_EXISTING=1.`
            );
        }
        console.log(`[desktop] Cleared stale listener on ${healthUrl}, continuing startup`);
    }

    const commandSpec = resolveLocalServerCommand();
    if (!fs.existsSync(commandSpec.cwd)) {
        throw new Error(`Local server working directory not found: ${commandSpec.cwd}`);
    }
    if (app.isPackaged && !fs.existsSync(commandSpec.command)) {
        throw new Error(`Packaged local server binary not found: ${commandSpec.command}`);
    }

    const child = spawn(commandSpec.command, commandSpec.args, {
        cwd: commandSpec.cwd,
        env: buildLocalServerEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    writeManagedServerPidToFile(child.pid);
    attachLocalServerLogs(child);

    let spawnError = null;
    child.once('error', (error) => {
        spawnError = error;
    });
    child.on('exit', (code, signal) => {
        const exitedUnexpectedly =
            !quitInFlight &&
            localServerState &&
            localServerState.mode === 'managed' &&
            localServerState.child === child;
        clearManagedServerPidFile();
        if (localServerState && localServerState.mode === 'managed' && localServerState.child === child) {
            localServerState = null;
        }
        if (exitedUnexpectedly) {
            console.error(`[desktop] Local server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
        }
    });

    localServerState = {
        mode: 'managed',
        child,
        healthUrl,
        commandSpec,
        stopPromise: null,
    };

    const timeoutMs = parsePositiveIntEnv(process.env.ELECTRON_LOCAL_SERVER_START_TIMEOUT_MS, 25000);
    const intervalMs = parsePositiveIntEnv(process.env.ELECTRON_LOCAL_SERVER_POLL_MS, 300);
    const ready = await waitForHealthReady(healthUrl, timeoutMs, intervalMs);
    if (!ready) {
        await stopManagedLocalServer();
        if (spawnError) {
            throw spawnError;
        }
        throw new Error(`Timed out waiting for local server health check: ${healthUrl}`);
    }

    console.log(`[desktop] Local server ready: ${healthUrl} (${commandSpec.source})`);
}

function formatLocalServerStartupError(error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
        `Local server startup failed: ${reason}`,
        '',
        'Desktop app requires a local Go server process.',
        'In development, verify `go` is installed and available in PATH.',
        'In packaged builds, verify local-server resources exist in the install directory.',
    ].join(os.EOL);
}

function trimTrailingSlash(url) {
    if (!url) {
        return '';
    }
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function normalizeApiBaseUrl(rawValue) {
    if (!rawValue || rawValue.trim() === '') {
        return '';
    }
    const value = trimTrailingSlash(rawValue.trim());
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        return trimTrailingSlash(url.toString());
    } catch {
        return '';
    }
}

function normalizeWsUrl(rawValue) {
    if (!rawValue || rawValue.trim() === '') {
        return '';
    }
    const value = rawValue.trim();
    try {
        const url = new URL(value);
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
            return '';
        }
        return url.toString();
    } catch {
        return '';
    }
}

function deriveWsUrlFromApiBase(apiBaseUrl) {
    if (!apiBaseUrl) {
        return '';
    }
    try {
        const url = new URL(apiBaseUrl);
        if (url.protocol === 'https:') {
            url.protocol = 'wss:';
        } else if (url.protocol === 'http:') {
            url.protocol = 'ws:';
        } else {
            return '';
        }
        url.pathname = '/ws';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function deriveApiBaseFromWs(wsUrl) {
    if (!wsUrl) {
        return '';
    }
    try {
        const url = new URL(wsUrl);
        if (url.protocol === 'wss:') {
            url.protocol = 'https:';
        } else if (url.protocol === 'ws:') {
            url.protocol = 'http:';
        } else {
            return '';
        }
        if (url.pathname === '/ws') {
            url.pathname = '/';
        }
        url.search = '';
        url.hash = '';
        return trimTrailingSlash(url.toString());
    } catch {
        return '';
    }
}

function resolveRuntimeNetworkScenario() {
    const raw = (process.env.ELECTRON_NETWORK_SCENARIO || '').trim().toLowerCase();
    if (raw === 'local' || raw === 'remote') {
        return raw;
    }
    return 'auto';
}

function resolveRemoteRuntimeNetworkConfig() {
    let apiBaseUrl = normalizeApiBaseUrl(
        process.env.ELECTRON_REMOTE_API_BASE_URL || process.env.ELECTRON_API_BASE_URL || ''
    );
    let wsUrl = normalizeWsUrl(process.env.ELECTRON_REMOTE_WS_URL || process.env.ELECTRON_WS_URL || '');

    if (!wsUrl && apiBaseUrl) {
        wsUrl = deriveWsUrlFromApiBase(apiBaseUrl);
    }
    if (!apiBaseUrl && wsUrl) {
        apiBaseUrl = deriveApiBaseFromWs(wsUrl);
    }

    if (!apiBaseUrl || !wsUrl) {
        throw new Error(
            'remote scenario requires ELECTRON_REMOTE_API_BASE_URL/ELECTRON_API_BASE_URL and ELECTRON_REMOTE_WS_URL/ELECTRON_WS_URL (one can be derived from the other)'
        );
    }

    return {
        scenario: 'remote',
        apiBaseUrl,
        wsUrl,
    };
}

function resolveLocalRuntimeNetworkConfig() {
    const addr = resolveLocalServerAddress();
    return {
        scenario: 'local',
        apiBaseUrl: `http://${addr}`,
        wsUrl: `ws://${addr}/ws`,
    };
}

function resolveRuntimeNetworkConfig() {
    const scenario = resolveRuntimeNetworkScenario();
    if (scenario === 'local') {
        return resolveLocalRuntimeNetworkConfig();
    }
    if (scenario === 'remote') {
        return resolveRemoteRuntimeNetworkConfig();
    }

    const hasRemoteApi = normalizeApiBaseUrl(
        process.env.ELECTRON_REMOTE_API_BASE_URL || process.env.ELECTRON_API_BASE_URL || ''
    ) !== '';
    const hasRemoteWs = normalizeWsUrl(process.env.ELECTRON_REMOTE_WS_URL || process.env.ELECTRON_WS_URL || '') !== '';
    if (hasRemoteApi || hasRemoteWs) {
        return resolveRemoteRuntimeNetworkConfig();
    }

    return resolveLocalRuntimeNetworkConfig();
}

function applyRuntimeNetworkConfigToEnv(config) {
    process.env.ELECTRON_RUNTIME_NETWORK_SCENARIO = config.scenario;
    process.env.ELECTRON_RUNTIME_API_BASE_URL = config.apiBaseUrl;
    process.env.ELECTRON_RUNTIME_WS_URL = config.wsUrl;
}

function formatRuntimeNetworkError(error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
        `Runtime network config failed: ${reason}`,
        '',
        'Set ELECTRON_NETWORK_SCENARIO=local|remote|auto.',
        'For remote, provide ELECTRON_REMOTE_API_BASE_URL and/or ELECTRON_REMOTE_WS_URL.',
    ].join(os.EOL);
}

function normalizeRendererSearch() {
    const raw = process.env.ELECTRON_RENDERER_QUERY;
    if (!raw || raw.trim() === '') {
        return '';
    }
    return raw.startsWith('?') ? raw : `?${raw}`;
}

function mergeUrlSearch(urlString, extraSearch) {
    if (!extraSearch) {
        return urlString;
    }
    const url = new URL(urlString);
    const extraParams = new URLSearchParams(extraSearch.startsWith('?') ? extraSearch.slice(1) : extraSearch);
    for (const [key, value] of extraParams.entries()) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

function searchToQueryObject(search) {
    if (!search) {
        return undefined;
    }
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const query = {};
    for (const [key, value] of params.entries()) {
        query[key] = value;
    }
    return query;
}

function applyGpuInfoTheme(win) {
    if (!win || win.isDestroyed()) {
        return;
    }

    const gpuCss = `
        html, body {
            background: #0d1016 !important;
            color: #f2f7ff !important;
        }
        * {
            color: #f2f7ff !important;
            border-color: rgba(255, 255, 255, 0.24) !important;
        }
        a, a * {
            color: #79dfff !important;
        }
        code, pre {
            color: #d9f4ff !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }
    `;

    void win.webContents.insertCSS(gpuCss).catch(() => { });
}

function openGpuInfoWindow() {
    if (gpuInfoWindow && !gpuInfoWindow.isDestroyed()) {
        gpuInfoWindow.focus();
        return;
    }

    gpuInfoWindow = new BrowserWindow({
        width: 1080,
        height: 760,
        minWidth: 860,
        minHeight: 560,
        backgroundColor: '#120810',
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    });

    gpuInfoWindow.on('closed', () => {
        gpuInfoWindow = null;
    });

    gpuInfoWindow.webContents.on('dom-ready', () => {
        applyGpuInfoTheme(gpuInfoWindow);
    });
    gpuInfoWindow.webContents.on('did-finish-load', () => {
        applyGpuInfoTheme(gpuInfoWindow);
    });

    void gpuInfoWindow.loadURL('chrome://gpu');
}

function createAppMenu() {
    const template = [
        {
            label: 'Help',
            submenu: [
                {
                    label: 'GPU Info',
                    click: () => openGpuInfoWindow(),
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createWindow() {
    const rendererSearch = normalizeRendererSearch();
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        autoHideMenuBar: true,
        backgroundColor: '#120810',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    });

    // Lock aspect ratio to 16:10 so the desktop layout stays consistent on resize.
    win.setAspectRatio(1280 / 800);

    win.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow = win;
    win.on('closed', () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
        void win.loadURL(mergeUrlSearch(devUrl, rendererSearch));
        if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
            win.webContents.openDevTools({ mode: 'detach' });
        }
        return;
    }

    void win.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'), {
        query: searchToQueryObject(rendererSearch),
    });
}

app.whenReady().then(async () => {
    let runtimeNetworkConfig = null;
    try {
        runtimeNetworkConfig = resolveRuntimeNetworkConfig();
        applyRuntimeNetworkConfigToEnv(runtimeNetworkConfig);
    } catch (error) {
        dialog.showErrorBox('Holdem Lite - Network Config Error', formatRuntimeNetworkError(error));
        app.exit(1);
        return;
    }

    try {
        if (runtimeNetworkConfig.scenario === 'local') {
            await cleanupStaleManagedLocalServer();
            await ensureLocalServerReady();
        }
    } catch (error) {
        dialog.showErrorBox('Holdem Lite - Local Server Error', formatLocalServerStartupError(error));
        app.exit(1);
        return;
    }

    console.log(
        `[desktop] Runtime network: scenario=${runtimeNetworkConfig.scenario} api=${runtimeNetworkConfig.apiBaseUrl} ws=${runtimeNetworkConfig.wsUrl}`
    );

    createAppMenu();
    createWindow();

    ipcMain.handle('desktop:open-gpu-info', () => {
        openGpuInfoWindow();
        return true;
    });
    ipcMain.handle('desktop:quit-app', () => {
        app.quit();
        return true;
    });
    ipcMain.on('desktop:report-perf-sample', (event, payload) => {
        const senderPid =
            typeof event.sender?.getOSProcessId === 'function' ? event.sender.getOSProcessId() : undefined;
        appendPerfSample({
            tsMs: Date.now(),
            rendererPid: Number.isFinite(senderPid) && senderPid > 0 ? senderPid : event.processId,
            ...payload,
        });
    });
    ipcMain.handle('desktop:get-process-info', () => {
        return {
            mainPid: process.pid,
            rendererPid: mainWindow?.webContents.getOSProcessId() ?? -1,
        };
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    closePerfLogStream();
});

app.on('before-quit', (event) => {
    if (quitInFlight) {
        return;
    }
    if (!localServerState || localServerState.mode !== 'managed') {
        return;
    }
    quitInFlight = true;
    event.preventDefault();
    void stopManagedLocalServer().finally(() => {
        app.quit();
    });
});
