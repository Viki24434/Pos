const path = require('node:path');
const { createBackup } = require('../models/Backup.js');

function registerBackupHandlers(ipcMain, { app, BrowserWindow, dialog }) {
    let busy = false;
    ipcMain.handle('backup-database', async event => {
        if (busy) return { success: false, message: 'Backup masih berjalan.' };
        busy = true;
        try {
            const stamp = new Intl.DateTimeFormat('sv-SE', {
                timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            }).format(new Date()).replace(/[^0-9]/g, '');
            const selected = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
                title: 'Simpan Backup Database',
                defaultPath: path.join(app.getPath('documents'), `APP-js-backup-${stamp}.sqlite`),
                filters: [{ name: 'Database SQLite', extensions: ['sqlite'] }],
                properties: ['showOverwriteConfirmation', 'createDirectory'],
            });
            if (selected.canceled || !selected.filePath) return { canceled: true };
            return { success: true, ...await createBackup(selected.filePath) };
        } catch (error) {
            return { success: false, message: error.message || 'Gagal membuat backup database.' };
        } finally { busy = false; }
    });
}

module.exports = { registerBackupHandlers };
