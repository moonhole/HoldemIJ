const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');

let mainWindow = null;
let gpuInfoWindow = null;

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
        void win.loadURL(devUrl);
        win.webContents.openDevTools({ mode: 'detach' });
        return;
    }

    void win.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'));
}

app.whenReady().then(() => {
    createAppMenu();
    createWindow();

    ipcMain.handle('desktop:open-gpu-info', () => {
        openGpuInfoWindow();
        return true;
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
