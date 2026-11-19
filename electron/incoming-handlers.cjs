const Incoming = require('../models/IncomingStock.js');

function registerIncomingHandlers(ipcMain) {
    const mutate = operation => async (_event, data) => {
        try { return { success: true, result: await operation(data) }; }
        catch (error) { return { success: false, message: error.message || 'Gagal menyimpan barang masuk.' }; }
    };
    ipcMain.handle('get-suppliers', () => Incoming.getSuppliers());
    ipcMain.handle('save-supplier', mutate(Incoming.saveSupplier));
    ipcMain.handle('get-stock-receipts', (_event, filters) => Incoming.getReceipts(filters));
    ipcMain.handle('get-stock-receipt-detail', (_event, id) => Incoming.getReceiptDetail(id));
    ipcMain.handle('create-stock-receipt', mutate(Incoming.createReceipt));
}
module.exports = { registerIncomingHandlers };
