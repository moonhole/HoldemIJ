const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
    isDesktop: true,
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
    openGpuInfo: () => ipcRenderer.invoke('desktop:open-gpu-info'),
    reportPerfSample: (sample) => ipcRenderer.send('desktop:report-perf-sample', sample),
    getProcessInfo: () => ipcRenderer.invoke('desktop:get-process-info'),
});
