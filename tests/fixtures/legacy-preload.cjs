// Reproduce an already-running Electron process whose bridge predates payment methods.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
    checkActivation: () => ipcRenderer.invoke('check-activation'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    getIpAddress: () => ipcRenderer.invoke('get-ip-address'),
    getProducts: () => ipcRenderer.invoke('get-products'),
    getCategories: () => ipcRenderer.invoke('get-categories'),
});
