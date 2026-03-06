const { contextBridge, ipcRenderer } = require('electron');

const network = {
    scenario: process.env.ELECTRON_RUNTIME_NETWORK_SCENARIO || '',
    apiBaseUrl: process.env.ELECTRON_RUNTIME_API_BASE_URL || '',
    wsUrl: process.env.ELECTRON_RUNTIME_WS_URL || '',
};

contextBridge.exposeInMainWorld('desktopBridge', {
    isDesktop: true,
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
    network,
    openGpuInfo: () => ipcRenderer.invoke('desktop:open-gpu-info'),
    reportPerfSample: (sample) => ipcRenderer.send('desktop:report-perf-sample', sample),
    getProcessInfo: () => ipcRenderer.invoke('desktop:get-process-info'),
    quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
    // Resolution presets
    getPresetSizes: () => ipcRenderer.invoke('desktop:get-preset-sizes'),
    setWindowSize: (index) => ipcRenderer.invoke('desktop:set-size', { index }),
    // Fullscreen
    setFullScreen: (fullscreen) => ipcRenderer.invoke('desktop:set-fullscreen', { fullscreen }),
    getFullScreen: () => ipcRenderer.invoke('desktop:get-fullscreen'),
    onFullScreenChange: (callback) => {
        const handler = (_, isFullScreen) => callback(isFullScreen);
        ipcRenderer.on('desktop:fullscreen-changed', handler);
        return () => ipcRenderer.removeListener('desktop:fullscreen-changed', handler);
    },
});
