// Reproduce an already-running Electron process whose bridge predates payment methods.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
    checkAuth: () => ipcRenderer.invoke('check-auth'),
    login: (credentials) => ipcRenderer.invoke('auth-login', credentials),
    checkActivation: () => ipcRenderer.invoke('check-activation'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    getIpAddress: () => ipcRenderer.invoke('get-ip-address'),
    getProducts: () => ipcRenderer.invoke('get-products'),
    getCategories: () => ipcRenderer.invoke('get-categories'),
});
