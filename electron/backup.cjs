const path = require('node:path');
const { createBackupPackage, inspectBackupPackage, restoreBackupPackage } = require('../models/BackupPackage.js');

function registerBackupHandlers(ipcMain, { app, BrowserWindow, dialog }) {
    let busy = false;
    ipcMain.handle('restore-database', async event => {
        if (busy) return { success: false, message: 'Backup atau pemulihan masih berjalan.' };
        busy = true;
        try {
            const parent = BrowserWindow.fromWebContents(event.sender);
            const selected = await dialog.showOpenDialog(parent, {
                title: 'Pilih Backup untuk Dipulihkan', filters: [{ name: 'Database SQLite', extensions: ['zip', 'sqlite', 'db'] }], properties: ['openFile'],
            });
            if (selected.canceled || !selected.filePaths?.length) return { canceled: true };
            const filename = selected.filePaths[0];
            await inspectBackupPackage(filename);
            const confirmation = await dialog.showMessageBox(parent, {
                type: 'warning', title: 'Pulihkan Backup', message: 'Ganti data aplikasi dengan backup ini?',
                detail: `File: ${path.basename(filename)}\nData akan kembali ke kondisi saat backup dibuat. Cadangan data saat ini dibuat otomatis sebelum pemulihan. Setelah selesai, Anda perlu login menggunakan akun dari backup.`,
                buttons: ['Batal', 'Pulihkan Backup'], defaultId: 0, cancelId: 0, noLink: true,
            });
            if (confirmation.response !== 1) return { canceled: true };
            return { success: true, ...await restoreBackupPackage(filename, path.join(app.getPath('userData'), 'backups'), path.join(app.getPath('userData'), 'uploads', 'product')) };
        } catch (error) { return { success: false, message: error.message || 'Gagal memulihkan backup.' }; }
        finally { busy = false; }
    });
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
                defaultPath: path.join(app.getPath('documents'), `APP-js-backup-${stamp}.zip`),
                filters: [{ name: 'Backup Lengkap (Database dan Gambar)', extensions: ['zip'] }],
                properties: ['showOverwriteConfirmation', 'createDirectory'],
            });
            if (selected.canceled || !selected.filePath) return { canceled: true };
            return { success: true, ...await createBackupPackage(selected.filePath, path.join(app.getPath('userData'), 'uploads', 'product')) };
        } catch (error) {
            return { success: false, message: error.message || 'Gagal membuat backup database.' };
        } finally { busy = false; }
    });
}

module.exports = { registerBackupHandlers };
