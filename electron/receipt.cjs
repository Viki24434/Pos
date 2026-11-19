const { getDbConnection, withTransaction } = require('../config/db.js');
const Order = require('../models/Order.js');

async function getReceiptData(id) {
    const db = await getDbConnection();
    const order = await db.get('SELECT o.*, c.status as customer_status FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ? AND o.store_id = 1', [id]);
    if (!order) throw new Error('Pesanan tidak ditemukan.');
    return { order, items: await Order.getOrderItems(id), payments: await Order.getOrderPayments(id), store: await db.get('SELECT * FROM stores WHERE id = 1') || {} };
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const rupiah = value => 'Rp ' + Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
function renderReceipt(data, paper = data.store.receipt_paper || '80mm') {
    if (!['80mm', '58mm', 'A4'].includes(paper)) throw new Error('Ukuran kertas tidak valid.');
    const { order, items, payments = [], store } = data;
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
    const row = (label, value) => `<div class="line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(rupiah(value))}</strong></div>`;
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(order.invoice_number)}</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>@page{size:${paper === 'A4' ? 'A4' : paper + ' 297mm'};margin:${paper === 'A4' ? '12mm' : '4mm'}}
    *{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0;background:white}
    main{width:${paper === 'A4' ? '100%' : paper === '58mm' ? '50mm' : '72mm'};margin:0 auto;padding:8px 0}
    h1{font-size:18px;margin:0 0 5px}header,footer{text-align:center}p{margin:5px 0;overflow-wrap:anywhere;white-space:pre-line}
    hr{border:0;border-top:1px dashed #777;margin:12px 0}.line{display:flex;justify-content:space-between;gap:10px;margin:6px 0}
    .item{break-inside:avoid;margin:10px 0}.item strong{overflow-wrap:anywhere}.muted{font-size:11px;color:#444}.total{font-size:15px}
    </style></head><body><main><header><h1>${escapeHtml(store.name || 'POS Percetakan')}</h1><p>${escapeHtml(store.address)}</p><p>${escapeHtml(store.phone)}</p><hr><strong>STRUK PESANAN</strong></header>
    <p>${escapeHtml(order.invoice_number)}</p><p>${escapeHtml(order.created_at)}</p><p>Pelanggan: ${escapeHtml(order.customer_name)}${order.customer_status ? ' (' + escapeHtml(order.customer_status) + ')' : ''}</p><hr>
    ${items.map(item => `<div class="item"><strong>${escapeHtml(item.item_name || item.product_name)}</strong><div class="line"><span>${escapeHtml(item.qty)} x ${escapeHtml(rupiah(item.price))}</span><strong>${escapeHtml(rupiah(item.subtotal))}</strong></div></div>`).join('')}
    ${order.notes ? '<hr><strong>Catatan Pesanan</strong><p>' + escapeHtml(order.notes) + '</p>' : ''}
    <hr>${row('Subtotal', subtotal)}${row('Diskon', order.discount_amount)}${row('Pajak', order.tax_amount)}<div class="total">${row('TOTAL', order.total_amount)}</div><hr>
    ${payments.map(payment => row(payment.payment_method, payment.amount)).join('') || '<p>Belum ada pembayaran.</p>'}
    ${row('Total Dibayar', paid)}${row('Sisa Tagihan', Math.max(0, Math.round((order.total_amount - paid) * 100) / 100))}
    <p>Status: <strong>${escapeHtml(paid >= Number(order.total_amount) ? 'Lunas' : paid > 0 ? 'DP' : 'Belum Bayar')}</strong></p>
    <hr><footer><p>${escapeHtml(store.footer || 'Terima kasih atas kepercayaan Anda.')}</p></footer></main></body></html>`;
}
function registerPrintHandlers(ipcMain, BrowserWindow) {
    ipcMain.handle('get-print-settings', async () => {
        const db = await getDbConnection();
        return await db.get('SELECT receipt_paper, printer_name, print_direct FROM stores WHERE id = 1');
    });
    ipcMain.handle('get-printers', event => event.sender.getPrintersAsync());
    ipcMain.handle('save-print-settings', async (event, data) => {
        try {
            if (!['58mm', '80mm', 'A4'].includes(data.receipt_paper)) throw new Error('Ukuran kertas tidak valid.');
            const printerName = String(data.printer_name || '');
            if (printerName && !(await event.sender.getPrintersAsync()).some(printer => printer.name === printerName)) throw new Error('Printer tidak ditemukan. Muat ulang daftar printer.');
            if (data.print_direct && !printerName) throw new Error('Pilih printer untuk cetak langsung.');
            await withTransaction(async db => {
                const result = await db.run('UPDATE stores SET receipt_paper=?, printer_name=?, print_direct=? WHERE id=1', [data.receipt_paper, printerName, data.print_direct ? 1 : 0]);
                if (!result.changes) throw new Error('Pengaturan toko tidak ditemukan.');
            });
            return { success: true };
        } catch (error) { return { success: false, message: error.message }; }
    });
    ipcMain.handle('get-print-data', (_event, id) => getReceiptData(id));
    ipcMain.handle('preview-receipt', async (_event, id, paper) => renderReceipt(await getReceiptData(id), paper));
    ipcMain.handle('print-receipt', async (event, id, paper) => {
        let printWindow;
        try {
            const data = await getReceiptData(id);
            paper ||= data.store.receipt_paper || '80mm';
            const printerName = data.store.printer_name || '';
            if (printerName && !(await event.sender.getPrintersAsync()).some(printer => printer.name === printerName)) throw new Error('Printer tersimpan tidak tersedia. Periksa printer atau ubah Pengaturan Thermal.');
            const html = renderReceipt(data, paper);
            printWindow = new BrowserWindow({ show: false, parent: BrowserWindow.fromWebContents(event.sender), webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
            await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
            return await new Promise(resolve => printWindow.webContents.print({ silent: !!data.store.print_direct && !!printerName, deviceName: printerName, printBackground: true,
                pageSize: paper === 'A4' ? 'A4' : { width: paper === '58mm' ? 58000 : 80000, height: 297000 },
            }, (success, reason) => resolve({ success, message: success ? '' : reason || 'Pencetakan dibatalkan.' })));
        } catch (error) { return { success: false, message: error.message || 'Gagal mencetak struk.' }; }
        finally { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); }
    });
}
module.exports = { getReceiptData, renderReceipt, registerPrintHandlers };
