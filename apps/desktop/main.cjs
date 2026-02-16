const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let mainWindow = null;
let gpuInfoWindow = null;
let perfLogStream = null;

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

    void win.webContents.insertCSS(gpuCss).catch(() => {});
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

app.whenReady().then(() => {
    createAppMenu();
    createWindow();

    ipcMain.handle('desktop:open-gpu-info', () => {
        openGpuInfoWindow();
        return true;
    });
    ipcMain.on('desktop:report-perf-sample', (event, payload) => {
        appendPerfSample({
            tsMs: Date.now(),
            rendererPid: event.processId,
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
