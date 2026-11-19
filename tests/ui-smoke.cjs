// Run with: npx electron tests/ui-smoke.cjs
// Uses a hidden, isolated Electron window and an in-memory database.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection, inisialisasiDatabase } = require('../config/db.js');
const Product = require('../models/Product.js');
const Order = require('../models/Order.js');
const Customer = require('../models/Customer.js');
const Finance = require('../models/Finance.js');
const Report = require('../models/Report.js');
const { registerCustomerHandlers } = require('../electron/customer-handlers.cjs');
const { registerPaymentHandlers } = require('../electron/payment-handlers.cjs');
const { registerPrintHandlers } = require('../electron/receipt.cjs');
const { registerBackupHandlers } = require('../electron/backup.cjs');
const { registerIncomingHandlers } = require('../electron/incoming-handlers.cjs');

let server;
let window;
let profile;
let db;
let savedPayload;
let printed = false;
let expectedPaperWidth = 80000;
let expectedPrinter = '';

async function evaluate(code) {
    return window.webContents.executeJavaScript(code);
}

async function waitFor(expression) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`UI timeout: ${expression}`);
}

async function clickButton(text) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
}

async function fill(selector, value) {
    await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
}

app.whenReady().then(async () => {
    try {
        profile = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-variants-ui-'));
        app.setPath('userData', profile);
        const backupPath = path.join(profile, 'ui-backup.zip');
        registerBackupHandlers(ipcMain, { app, BrowserWindow, dialog: {
            showSaveDialog: async () => ({ canceled: false, filePath: backupPath }),
            showOpenDialog: async () => ({ canceled: false, filePaths: [backupPath] }),
            showMessageBox: async () => ({ response: 1 }),
        } });
        await inisialisasiDatabase();
        db = await getDbConnection();
        const express = require('express');
        const webApp = express();
        const distPath = path.resolve(__dirname, '../dist');
        await fs.access(path.join(distPath, 'index.html'));
        webApp.use(express.static(distPath));
        const httpServer = await new Promise(resolve => {
            const listening = webApp.listen(0, '127.0.0.1', () => resolve(listening));
        });
        server = {
            resolvedUrls: { local: [`http://127.0.0.1:${httpServer.address().port}/`] },
            close: () => new Promise(resolve => httpServer.close(resolve)),
        };
        ipcMain.handle('check-activation', () => true);
        ipcMain.handle('get-settings', () => ({ name: 'Test' }));
        ipcMain.handle('get-ip-address', () => '127.0.0.1');
        ipcMain.handle('get-products', () => Product.getAll());
        ipcMain.handle('get-categories', () => []);
        ipcMain.handle('get-units', () => []);
        registerPaymentHandlers(ipcMain);
        registerIncomingHandlers(ipcMain);
        const printWindowFactory = function(options) {
            const target = new BrowserWindow(options);
            target.webContents.print = (printOptions, callback) => {
                assert.equal(printOptions.silent, !!expectedPrinter);
                assert.equal(printOptions.deviceName, expectedPrinter);
                assert.equal(printOptions.pageSize.width, expectedPaperWidth);
                printed = true;
                callback(true);
            };
            return target;
        };
        printWindowFactory.fromWebContents = contents => BrowserWindow.fromWebContents(contents);
        registerPrintHandlers(ipcMain, printWindowFactory);
        ipcMain.handle('get-order-detail', (_event, id) => Order.getOrderItems(id));
        ipcMain.handle('get-finance-summary', (_event, filters) => Finance.getSummary(filters.start, filters.end));
        ipcMain.handle('get-sales-profit-report', (_event, filters) => Report.getSalesProfitReport(filters));
        ipcMain.handle('save-order-costs', async (_event, id, costs) => {
            try { return await Report.saveOrderCosts(id, costs); }
            catch (error) { return { success: false, message: error.message }; }
        });
        registerCustomerHandlers(ipcMain);
        ipcMain.handle('create-product', async (_event, payload) => {
            savedPayload = payload;
            try { await Product.create(payload); return true; }
            catch (error) { return { success: false, message: error.message }; }
        });
        ipcMain.handle('update-product', async (_event, id, payload) => {
            savedPayload = payload;
            try { await Product.update(id, payload); return true; }
            catch (error) { return { success: false, message: error.message }; }
        });
        const isolatedSession = session.fromPartition(`variants-ui-${Date.now()}`);
        window = new BrowserWindow({ show: false, width: 1280, height: 900,
            webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), session: isolatedSession, backgroundThrottling: false, offscreen: true } });
        window.webContents.on('console-message', event => {
            if (event.level === 'error') console.error('Renderer:', event.message);
        });
        window.webContents.getPrintersAsync = async () => [{ name: 'THERMAL-TEST', displayName: 'Thermal Test' }];
        await window.loadURL(`${server.resolvedUrls.local[0]}?ui-session=1#/products`);
        await evaluate(`localStorage.setItem('pos_session', JSON.stringify({ id: 1, name: 'Test', role: 'Super Admin' })); true;`);
        await window.loadURL(`${server.resolvedUrls.local[0]}?ui-session=2#/products`);
        await waitFor(`document.body.innerText.includes('Manajemen Produk')`);
        await clickButton('Tambah Produk');
        await fill('#modal-product input[placeholder="Otomatis"]', 'UI-KAOS');
        await fill('#modal-product input[required]', 'Kaos UI');
        await clickButton('Tambah Varian');
        await fill('.variant-editor-row:nth-child(2) input', 'Merah / XL');
        await fill('.variant-editor-row:nth-child(2) input[type="number"]', 60000);
        await fill('.variant-editor-row:nth-child(2) input[step="1"]', 5);
        await fill('.variant-editor-row:nth-child(2) input[placeholder="Harga biasa"]', 45000);
        await fill('.variant-editor-row:nth-child(2) input[placeholder="Modal produk"]', 30000);
        await evaluate(`document.querySelector('.variant-editor-row .wholesale-editor summary').click()`);
        await clickButton('Tambah Tingkat Harga');
        await fill('.wholesale-tier input[step="1"]', 2);
        await fill('.wholesale-tier input[step="0.01"]', 59000);
        await evaluate(`document.querySelector('.bonus-editor summary').click(); document.querySelector('.bonus-editor input[type="checkbox"]').click()`);
        await fill('.bonus-editor input[aria-label="Jumlah beli untuk promo"]', 4);
        await clickButton('Tambah Varian');
        await fill('.variant-editor-row:nth-child(3) input', 'Biru / L');
        await fill('.variant-editor-row:nth-child(3) input[type="number"]', 55000);
        await fill('.variant-editor-row:nth-child(3) input[step="1"]', 3);
        await fill('.variant-editor-row:nth-child(3) input[placeholder="Modal produk"]', 25000);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await fs.mkdir(process.env.APP_JS_UI_SCREENSHOTS, { recursive: true });
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'variant-form.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Produk');
        await waitFor(`!document.querySelector('#modal-product') && document.body.innerText.includes('Kaos UI')`);
        assert.equal(savedPayload.variants.length, 2);
        assert.deepEqual(savedPayload.variants[0].wholesale_prices, [{ min_qty: 2, price: 59000 }]);
        assert.equal(savedPayload.variants[0].buy_qty, 4);
        assert.equal(savedPayload.variants[0].free_qty, 1);
        const [product] = await Product.getAll();
        assert.equal(product.stock, 8);
        assert.equal(product.price, 55000);
        console.log('PASS: product form saves two variants and aggregate stock');

        // Reopen and save to ensure stable variant IDs survive editing.
        await evaluate(`document.querySelector('button[title="Edit"]').click()`);
        await waitFor(`document.querySelectorAll('.variant-editor-row').length === 2`);
        await clickButton('Simpan Produk');
        await waitFor(`!document.querySelector('#modal-product')`);
        assert.equal((await Product.getById(product.id)).variants[0].id, product.variants[0].id);
        console.log('PASS: editing preserves existing variant IDs');

        await evaluate(`location.hash = '#/orders/create'`);
        await waitFor(`document.querySelectorAll('.product-tile').length === 1`);
        await evaluate(`window.alert = () => {}; document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'variant-picker.png'), (await window.webContents.capturePage()).toPNG());
        }
        await evaluate(`document.querySelectorAll('.variant-option')[0].click()`);
        await waitFor(`document.querySelectorAll('.cart-table-wrapper tbody tr').length === 1 && document.body.innerText.includes('Kaos UI - Merah / XL')`);
        await evaluate(`document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        await evaluate(`document.querySelectorAll('.variant-option')[1].click()`);
        await waitFor(`document.querySelectorAll('.qty-stepper').length === 2`);
        await evaluate(`document.querySelectorAll('.qty-stepper')[1].querySelectorAll('button')[1].click()`);
        await waitFor(`document.querySelectorAll('.qty-stepper')[1].textContent.includes('2')`);
        assert.equal(await evaluate(`document.querySelector('.order-notes').open`), false);
        await evaluate(`document.querySelector('.order-notes summary').click()`);
        await fill('#order-notes', 'Pisahkan kemasan & kirim\nSore hari');
        await clickButton('Bayar Sekarang');
        await waitFor(`!!document.querySelector('#checkout-payment #payment-method option[value="Cash"]')`);
        await fill('#payment-amount', 200000);
        await waitFor(`document.querySelector('#checkout-payment').innerText.includes('30.000')`);
        await clickButton('Simpan Pesanan & Pembayaran');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan')`);
        assert.deepEqual((await Product.getById(product.id)).variants.map(variant => variant.stock), [4, 1]);
        const order = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(order.total_amount, 170000);
        assert.equal(order.payment_status, 'Lunas');
        assert.equal(order.notes, 'Pisahkan kemasan & kirim\nSore hari');
        assert.equal((await Order.getOrderItems(order.id)).length, 2);
        assert.equal((await db.get('SELECT SUM(amount) as amount FROM payments WHERE order_id = ?', [order.id])).amount, 170000);
        console.log('PASS: cashier keeps variants separate, changes quantities, and completes paid checkout');
        await evaluate(`document.querySelector('button[title="Detail"]').click()`);
        await waitFor(`!!document.querySelector('.order-detail-notes')`);
        assert.equal(await evaluate(`document.querySelector('.order-detail-notes p').textContent`), order.notes);
        await evaluate(`document.querySelector('.modal-close').click()`);
        await evaluate(`document.querySelector('button[title="Cetak Struk"]').click()`);
        await waitFor(`!!document.querySelector('#receipt-preview iframe')`);
        assert.ok(await evaluate(`document.querySelector('#receipt-preview iframe').srcdoc.includes('Kaos UI - Merah / XL')`));
        assert.ok(await evaluate(`document.querySelector('#receipt-preview iframe').srcdoc.includes('Pisahkan kemasan &amp; kirim\\nSore hari')`));
        await clickButton('Cetak Struk');
        await waitFor(`!document.querySelector('#receipt-preview button[type="button"]:disabled')`);
        assert.equal(printed, true);
        await evaluate(`document.querySelector('#receipt-preview .modal-close').click()`);
        console.log('PASS: receipt preview and native print request without sending paper to a printer');
        await evaluate(`location.hash = '#/finance'`);
        await waitFor(`document.body.innerText.includes('170.000')`);
        assert.equal(await evaluate(`document.body.innerText.includes('Metode Lain')`), false);
        console.log('PASS: finance hides other-method cards and columns when only cash and transfer exist');

        await evaluate(`location.hash = '#/settings'`);
        await waitFor(`!!document.querySelector('#payment-method-name')`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await waitFor(`!!document.querySelector('#receipt-printer-setting option[value="THERMAL-TEST"]')`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'settings-desktop.png'), (await window.webContents.capturePage()).toPNG());
            await evaluate(`document.querySelector('.backup-card').scrollIntoView({ block: 'center' })`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'backup-desktop.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(720, 1000);
            await evaluate(`window.scrollTo(0, 0)`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'settings-narrow.png'), (await window.webContents.capturePage()).toPNG());
            await evaluate(`document.querySelector('.backup-card').scrollIntoView({ block: 'center' })`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'backup-narrow.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(1280, 900);
            await evaluate(`window.scrollTo(0, 0)`);
        }
        await fill('#payment-method-name', 'DANA');
        await clickButton('Tambah Metode');
        await waitFor(`document.querySelector('#payment-method-name').value === '' && document.body.innerText.includes('DANA')`);
        console.log('PASS: settings creates a custom payment method');
        await clickButton('Backup Database');
        await waitFor(`document.body.innerText.includes('Backup berhasil disimpan')`);
        const { open } = require('sqlite');
        const sqlite3 = require('sqlite3');
        const archive = await require('unzipper').Open.file(backupPath);
        const databaseEntry = archive.files.find(entry => entry.path === 'database.sqlite');
        const extractedDatabase = path.join(profile, 'checked-backup.sqlite');
        await fs.writeFile(extractedDatabase, await databaseEntry.buffer());
        const backedUp = await open({ filename: extractedDatabase, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
        assert.equal((await backedUp.get('SELECT COUNT(*) as count FROM orders')).count, (await db.get('SELECT COUNT(*) as count FROM orders')).count);
        await backedUp.close();
        console.log('PASS: backup button creates a readable database through the save dialog');
        await waitFor(`!!document.querySelector('#receipt-printer-setting option[value="THERMAL-TEST"]')`);
        await evaluate(`document.querySelector('#receipt-paper-setting').value = '58mm'; document.querySelector('#receipt-paper-setting').dispatchEvent(new Event('change', { bubbles: true }))`);
        await evaluate(`document.querySelector('#receipt-printer-setting').value = 'THERMAL-TEST'; document.querySelector('#receipt-printer-setting').dispatchEvent(new Event('change', { bubbles: true }))`);
        await evaluate(`document.querySelector('#receipt-direct-setting').click()`);
        await clickButton('Simpan Pengaturan Thermal');
        await waitFor(`document.body.innerText.includes('Pengaturan thermal disimpan')`);
        expectedPaperWidth = 58000;
        expectedPrinter = 'THERMAL-TEST';
        printed = false;
        await evaluate(`location.hash = '#/orders'`);
        await waitFor(`!!document.querySelector('button[title="Cetak Struk"]')`);
        await evaluate(`document.querySelector('button[title="Cetak Struk"]').click()`);
        await waitFor(`document.querySelector('#receipt-preview')?.innerText.includes('58mm')`);
        await clickButton('Cetak Struk');
        await waitFor(`!document.querySelector('#receipt-preview button[type="button"]:disabled')`);
        assert.equal(printed, true);
        await evaluate(`document.querySelector('#receipt-preview .modal-close').click()`);
        console.log('PASS: saved thermal size and printer are automatically used for printing');

        await evaluate(`location.hash = '#/orders/create'`);
        await waitFor(`document.querySelectorAll('.product-tile').length === 1`);
        await evaluate(`document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        await evaluate(`document.querySelectorAll('.variant-option')[0].click()`);
        await clickButton('Bayar Sekarang');
        await waitFor(`!!document.querySelector('#payment-method option[value="DANA"]')`);
        await evaluate(`document.querySelector('#payment-method').value = 'DANA'; document.querySelector('#payment-method').dispatchEvent(new Event('change', { bubbles: true }))`);
        await fill('#payment-amount', 20000);
        await clickButton('Simpan Pesanan & Pembayaran');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan') && !!document.querySelector('button[title="Bayar"]')`);
        const depositOrder = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(depositOrder.payment_status, 'DP');
        assert.equal((await db.get('SELECT payment_method FROM payments WHERE order_id = ?', [depositOrder.id])).payment_method, 'DANA');
        await evaluate(`document.querySelector('button[title="Bayar"]').click()`);
        await waitFor(`!!document.querySelector('#order-payment #payment-method option[value="DANA"]')`);
        assert.equal(await evaluate(`document.querySelector('#payment-amount').value`), '40000');
        await evaluate(`document.querySelector('#payment-method').value = 'DANA'; document.querySelector('#payment-method').dispatchEvent(new Event('change', { bubbles: true }))`);
        await fill('#payment-amount', 50000);
        await clickButton('Simpan Pembayaran');
        await waitFor(`document.querySelector('#order-payment').innerText.includes('tidak boleh melebihi tagihan')`);
        await fill('#payment-amount', 15000);
        await clickButton('Tambah Pembayaran');
        await waitFor(`document.querySelectorAll('.payment-entry').length === 2`);
        await fill('#payment-amount-1', 30000);
        await waitFor(`document.querySelector('#order-payment').innerText.includes('5.000')`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'payment-custom.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Pembayaran');
        await waitFor(`!document.querySelector('#order-payment') && !document.querySelector('button[title="Bayar"]')`);
        assert.equal((await Order.getOrderById(depositOrder.id)).payment_status, 'Lunas');
        assert.equal((await db.get('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [depositOrder.id])).total, 60000);
        await evaluate(`Array.from(document.querySelectorAll('tr')).find(row => row.innerText.includes(${JSON.stringify(depositOrder.invoice_number)})).querySelector('button[title="Detail"]').click()`);
        await waitFor(`document.body.innerText.includes('Pembayaran Tercatat') && document.body.innerText.includes('DANA')`);
        assert.equal((await Order.getOrderPayments(depositOrder.id)).length, 3);
        assert.deepEqual((await Order.getOrderPayments(depositOrder.id)).map(entry => entry.amount), [20000, 15000, 25000]);
        console.log('PASS: custom-method deposit, excessive-payment error and later settlement through real IPC');
        await evaluate(`location.hash = '#/finance'`);
        await waitFor(`document.body.innerText.includes('DANA') && document.body.innerText.includes('35.000')`);
        assert.equal((await Finance.getSummary('', '')).saldoOther, 35000);
        assert.equal(await evaluate(`document.body.innerText.includes('Saldo Metode Lain')`), true);
        console.log('PASS: custom-method receipts appear in the finance page');
        await db.run('UPDATE order_items SET purchase_price = NULL WHERE order_id = ?', [depositOrder.id]);
        await evaluate(`location.hash = '#/reports'`);
        await waitFor(`document.body.innerText.includes('Laporan Penjualan dan Laba') && document.body.innerText.includes('Rincian Penjualan')`);
        assert.ok(await evaluate(`document.body.innerText.includes('Modal Tercatat') && document.body.innerText.includes('Laba Bersih')`));
        await waitFor(`!!document.querySelector('.reports-missing-cost .report-cost-button')`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'report-cost-button.png'), (await window.webContents.capturePage()).toPNG());
        }
        await evaluate(`document.querySelector('.reports-missing-cost .report-cost-button').click()`);
        await waitFor(`!!document.querySelector('#report-cost-modal input[type="number"]')`);
        await fill('#report-cost-modal input[type="number"]', 30000);
        await clickButton('Simpan Modal');
        await waitFor(`!document.querySelector('#report-cost-modal') && !document.querySelector('.reports-missing-cost')`);
        assert.equal((await Order.getOrderItems(depositOrder.id))[0].purchase_price, 30000);
        console.log('PASS: missing-cost link opens an entry form and recalculates the profit report');
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'sales-profit-report.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(980, 900);
            await evaluate(`document.querySelector('.reports-totals').scrollIntoView({ block: 'center' })`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'report-totals-narrow.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(1280, 900);
            await evaluate(`window.scrollTo(0, 0)`);
        }
        console.log('PASS: sales and profit report loads through the report page');

        await evaluate(`location.hash = '#/customers'`);
        await waitFor(`document.body.innerText.includes('Data Langganan') && document.body.innerText.includes('Tidak ada data pelanggan.')`);
        await clickButton('Tambah Pelanggan');
        await waitFor(`!!document.querySelector('#modal-customer')`);
        await fill('#customer-name', '   ');
        await clickButton('Simpan');
        await waitFor(`document.querySelector('#modal-customer').innerText.includes('Nama pelanggan wajib diisi.')`);
        await fill('#customer-name', 'Pelanggan UI');
        await fill('#customer-phone', '08123456789');
        await evaluate(`document.querySelector('#customer-status').value = 'VIP'; document.querySelector('#customer-status').dispatchEvent(new Event('change', { bubbles: true }))`);
        await clickButton('Simpan');
        await waitFor(`!document.querySelector('#modal-customer') && document.body.innerText.includes('Pelanggan UI') && document.body.innerText.includes('VIP')`);
        let [customer] = await Customer.getCustomers();
        assert.equal(customer.status, 'VIP');
        assert.equal(customer.is_member, 1);
        console.log('PASS: customer add button, modal, validation, VIP save and table display');

        await evaluate(`location.hash = '#/orders/create'`);
        await waitFor(`!!document.querySelector('#order-customer option[value="${customer.id}"]') && document.querySelectorAll('.product-tile').length === 1`);
        await evaluate(`document.querySelector('#order-customer').value = '${customer.id}'; document.querySelector('#order-customer').dispatchEvent(new Event('change', { bubbles: true }))`);
        await waitFor(`document.querySelector('.cart-panel').innerText.includes('VIP')`);
        await evaluate(`document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        await evaluate(`document.querySelectorAll('.variant-option')[0].click()`);
        await clickButton('Simpan Pesanan (Bayar Nanti)');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan') && document.body.innerText.includes('Pelanggan UI') && document.body.innerText.includes('VIP')`);
        const vipOrder = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(vipOrder.total_amount, 45000);
        assert.equal(vipOrder.customer_id, customer.id);
        assert.equal(vipOrder.customer_name, 'Pelanggan UI');
        console.log('PASS: selecting a VIP links the customer to the order and displays VIP in history');
        await evaluate(`location.hash = '#/customers'`);
        await waitFor(`document.body.innerText.includes('Data Langganan') && !!document.querySelector('button[title="Edit"]')`);

        await evaluate(`document.querySelector('button[title="Edit"]').click()`);
        await waitFor(`!!document.querySelector('#modal-customer')`);
        assert.equal(await evaluate(`document.querySelector('#customer-status').value`), 'VIP');
        await fill('#customer-name', 'Pelanggan Diedit');
        await evaluate(`document.querySelector('#customer-status').value = 'Umum'; document.querySelector('#customer-status').dispatchEvent(new Event('change', { bubbles: true }))`);
        await clickButton('Simpan');
        await waitFor(`!document.querySelector('#modal-customer') && document.body.innerText.includes('Pelanggan Diedit') && document.body.innerText.includes('Umum')`);
        [customer] = await Customer.getCustomers();
        assert.equal(customer.is_member, 0);
        assert.equal(customer.status, 'Umum');
        await fill('input[placeholder="Cari nama atau no. telepon..."]', 'Tidak cocok');
        await waitFor(`document.body.innerText.includes('Tidak ada data pelanggan.')`);
        await fill('input[placeholder="Cari nama atau no. telepon..."]', '08123456789');
        await waitFor(`document.body.innerText.includes('Pelanggan Diedit')`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'customers.png'), (await window.webContents.capturePage()).toPNG());
        }
        console.log('PASS: customer edit preserves status and phone search works');
        await evaluate(`window.confirm = () => true; document.querySelector('button[title="Hapus"]').click()`);
        await waitFor(`document.body.innerText.includes('Tidak ada data pelanggan.')`);
        assert.equal((await Customer.getCustomers()).length, 0);
        console.log('PASS: customer delete removes the selected row');

        await evaluate(`location.hash = '#/orders/create'`);
        await waitFor(`document.querySelectorAll('.product-tile').length === 1`);
        await evaluate(`document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        await evaluate(`document.querySelectorAll('.variant-option')[0].click()`);
        await clickButton('Simpan Pesanan (Bayar Nanti)');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan') && !!document.querySelector('button[title="Bayar"]')`);
        assert.match(await evaluate(`document.querySelector('button[title="Bayar"]').textContent`), /Bayar/);
        const unpaid = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(unpaid.payment_status, 'Belum Bayar');
        assert.equal((await Order.getOrderPayments(unpaid.id)).length, 0);
        console.log('PASS: save unpaid order exposes a labeled Bayar button');

        await evaluate(`document.querySelector('a[href="#/receivables"]').click()`);
        await waitFor(`!!document.querySelector('#receivable-search') && !!document.querySelector('button[title="Bayar Piutang"]')`);
        await fill('#receivable-search', unpaid.invoice_number);
        await clickButton('Cari');
        await waitFor(`document.querySelectorAll('.receivable-table tbody tr').length === 1 && !!document.querySelector('button[title="Bayar Piutang"]')`);
        assert.ok(await evaluate(`document.querySelector('.receivable-summary').innerText.includes('60.000')`));
        await evaluate(`document.querySelector('button[title="Atur Jatuh Tempo"]').click()`);
        await waitFor(`!!document.querySelector('#receivable-due-date')`);
        const { yesterday } = await db.get("SELECT DATE('now','localtime','-1 day') as yesterday");
        await fill('#receivable-due-date', yesterday);
        await clickButton('Simpan Jatuh Tempo');
        await waitFor(`!document.querySelector('#receivable-due-modal') && document.querySelector('.receivable-table').innerText.includes('Lewat jatuh tempo')`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'receivables-desktop.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(650, 950);
            await new Promise(resolve => setTimeout(resolve, 350));
            assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'receivables-narrow.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(1280, 900);
        }
        await evaluate(`document.querySelector('button[title="Bayar Piutang"]').click()`);
        await waitFor(`!!document.querySelector('#receivable-payment #payment-method option[value="Cash"]')`);
        await fill('#payment-amount', 20000);
        await clickButton('Simpan Pembayaran');
        await waitFor(`!document.querySelector('#receivable-payment') && document.querySelector('.receivable-table').innerText.includes('40.000')`);
        assert.equal((await Order.getOrderPayments(unpaid.id))[0].amount, 20000);
        await evaluate(`document.querySelector('button[title="Riwayat Piutang"]').click()`);
        await waitFor(`!!document.querySelector('#receivable-history') && document.querySelector('#receivable-history').innerText.includes('Cash')`);
        assert.ok(await evaluate(`document.querySelector('#receivable-history').innerText.includes('20.000')`));
        await evaluate(`document.querySelector('#receivable-history .modal-close').click()`);
        await evaluate(`document.querySelector('button[title="Bayar Piutang"]').click()`);
        await waitFor(`!!document.querySelector('#receivable-payment #payment-method option[value="Transfer"]')`);
        await evaluate(`document.querySelector('#payment-method').value = 'Transfer'; document.querySelector('#payment-method').dispatchEvent(new Event('change', {bubbles:true}))`);
        await clickButton('Simpan Pembayaran');
        await waitFor(`!document.querySelector('#receivable-payment') && document.querySelector('.receivable-table').innerText.includes('Tidak ada piutang sesuai filter.')`);
        assert.equal((await Order.getOrderById(unpaid.id)).payment_status, 'Lunas');
        assert.equal((await Order.getOrderPayments(unpaid.id)).length, 2);
        console.log('PASS: receivables navigation, invoice search, due date, overdue display, installment history and settlement through real IPC');

        const mainWindow = window;
        window = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: {
            preload: path.resolve(__dirname, 'fixtures/legacy-preload.cjs'), session: isolatedSession, backgroundThrottling: false, offscreen: true,
        } });
        await window.loadURL(`${server.resolvedUrls.local[0]}?legacy-api=1#/orders/create`);
        await waitFor(`document.querySelectorAll('.product-tile').length === 1`);
        await evaluate(`document.querySelector('.product-tile').click()`);
        await waitFor(`document.querySelectorAll('.variant-option').length === 2`);
        await evaluate(`document.querySelectorAll('.variant-option')[0].click()`);
        await clickButton('Bayar Sekarang');
        await waitFor(`document.querySelector('#checkout-payment')?.innerText.includes('Modul pembayaran belum dimuat')`);
        assert.ok(await evaluate(`document.body.innerText.includes('Kasir / Transaksi Baru')`));
        await evaluate(`location.hash = '#/settings'`);
        await waitFor(`document.body.innerText.includes('Metode Pembayaran') && document.body.innerText.includes('Modul pembayaran belum dimuat')`);
        window.destroy();
        window = mainWindow;
        console.log('PASS: old payment bridge shows recovery instructions instead of a blank page');

        await evaluate(`location.hash = '#/products'`);
        await waitFor(`document.body.innerText.includes('Manajemen Produk')`);
        await clickButton('Tambah Produk');
        await fill('#modal-product input[placeholder="Otomatis"]', 'GRO-UI');
        await fill('#modal-product input[required]', 'Minyak Grosir UI');
        await evaluate(`(() => { const inputs = Array.from(document.querySelectorAll('#modal-product .input-group')); for (const [label, value] of [['Harga Jual', '10000'], ['Stok', '100']]) { const input = inputs.find(group => group.querySelector('label')?.textContent.startsWith(label)).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
        await evaluate(`document.querySelector('.wholesale-editor summary').click()`);
        await clickButton('Tambah Tingkat Harga');
        await fill('.wholesale-tier:nth-of-type(1) input', 6);
        await fill('.wholesale-tier:nth-of-type(1) input[step="0.01"]', 9000);
        await clickButton('Tambah Tingkat Harga');
        await fill('.wholesale-tier:nth-of-type(2) input', 12);
        await fill('.wholesale-tier:nth-of-type(2) input[step="0.01"]', 8000);
        await evaluate(`document.querySelector('.bonus-editor summary').click(); document.querySelector('.bonus-editor input[type="checkbox"]').click()`);
        await fill('.bonus-editor input[aria-label="Jumlah beli untuk promo"]', 4);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await evaluate(`document.querySelector('.wholesale-editor').scrollIntoView({block:'center'})`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'wholesale-editor.png'), (await window.webContents.capturePage()).toPNG());
            await evaluate(`document.querySelector('.bonus-editor').scrollIntoView({block:'center'})`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'bonus-editor.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Produk');
        await waitFor(`!document.querySelector('#modal-product') && document.body.innerText.includes('Minyak Grosir UI')`);
        const wholesaleProduct = (await Product.getAll()).find(row => row.code === 'GRO-UI');
        assert.deepEqual(wholesaleProduct.wholesale_prices, [{ min_qty: 6, price: 9000 }, { min_qty: 12, price: 8000 }]);
        await evaluate(`location.hash = '#/orders/create'`);
        await waitFor(`document.querySelectorAll('.product-tile').length === 2`);
        await evaluate(`Array.from(document.querySelectorAll('.product-tile')).find(tile => tile.innerText.includes('Minyak Grosir UI')).click()`);
        await waitFor(`document.querySelectorAll('.qty-stepper').length === 1`);
        for (let quantity = 2; quantity <= 12; quantity++) {
            await evaluate(`document.querySelector('.qty-stepper button:last-child').click()`);
            await waitFor(`document.querySelector('.qty-stepper').textContent.includes('${quantity}')`);
            if (quantity === 6) assert.ok(await evaluate(`document.querySelector('.cart-unit-price').textContent.includes('9.000')`));
        }
        assert.ok(await evaluate(`document.querySelector('.cart-unit-price').textContent.includes('8.000')`));
        assert.equal(await evaluate(`document.querySelectorAll('.cart-table-wrapper tbody tr').length`), 2);
        assert.equal(await evaluate(`document.querySelector('.cart-table-wrapper tbody tr:last-child td:nth-child(2)').textContent`), '3');
        await evaluate(`document.querySelector('.qty-stepper button:first-child').click()`);
        await waitFor(`document.querySelector('.cart-unit-price').textContent.includes('9.000')`);
        assert.equal(await evaluate(`document.querySelector('.cart-table-wrapper tbody tr:last-child td:nth-child(2)').textContent`), '2');
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await evaluate(`document.querySelector('.cart-panel').scrollIntoView({block:'center'})`);
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'bonus-cart.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Pesanan (Bayar Nanti)');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan')`);
        const wholesaleOrder = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(wholesaleOrder.total_amount, 99000);
        assert.equal((await Order.getOrderItems(wholesaleOrder.id))[0].price, 9000);
        const bonusItem = (await Order.getOrderItems(wholesaleOrder.id)).find(row => row.is_free);
        assert.equal(bonusItem.qty, 2);
        assert.equal(bonusItem.subtotal, 0);
        assert.equal((await Product.getById(wholesaleProduct.id)).stock, 87);
        await evaluate(`Array.from(document.querySelectorAll('tr')).find(row => row.innerText.includes(${JSON.stringify(wholesaleOrder.invoice_number)})).querySelector('button[title="Detail"]').click()`);
        await waitFor(`document.body.innerText.includes('Minyak Grosir UI (Gratis)')`);
        await evaluate(`document.querySelector('.modal-close').click()`);
        await evaluate(`Array.from(document.querySelectorAll('tr')).find(row => row.innerText.includes(${JSON.stringify(wholesaleOrder.invoice_number)})).querySelector('button[title="Cetak Struk"]').click()`);
        await waitFor(`!!document.querySelector('#receipt-preview iframe')`);
        assert.ok(await evaluate(`document.querySelector('#receipt-preview iframe').srcdoc.includes('Minyak Grosir UI (Gratis)')`));
        await evaluate(`document.querySelector('#receipt-preview .modal-close').click()`);
        console.log('PASS: buy-4-get-1 promotion repeats, updates bonus quantities, deducts stock and appears in details and receipts');
        console.log('PASS: wholesale editor saves tiers and checkout reprices upward and downward across quantity thresholds');

        await evaluate(`document.querySelector('a[href="#/incoming-stock"]').click()`);
        await waitFor(`document.body.innerText.includes('Barang Masuk & Supplier') && document.body.innerText.includes('Belum ada barang masuk sesuai filter.')`);
        await clickButton('Tambah Barang Masuk');
        await waitFor(`!!document.querySelector('#incoming-form')`);
        await clickButton('Tambah Supplier');
        await waitFor(`!!document.querySelector('#supplier-name')`);
        await fill('#supplier-name', 'Supplier UI');
        await fill('#supplier-phone', '081234000');
        await fill('#supplier-address', 'Jalan Pasar');
        await clickButton('Simpan Supplier');
        await waitFor(`!!document.querySelector('#incoming-form') && document.querySelector('#incoming-supplier').value !== ''`);
        const supplierId = Number(await evaluate(`document.querySelector('#incoming-supplier').value`));
        await fill('#incoming-reference', 'NOTA-UI-001');
        await evaluate(`document.querySelector('.incoming-item select').value = '${wholesaleProduct.id}:0'; document.querySelector('.incoming-item select').dispatchEvent(new Event('change', {bubbles:true}))`);
        await fill('input[aria-label="Jumlah barang 1"]', 24);
        await fill('input[aria-label="Harga beli barang 1"]', 7000);
        await clickButton('Tambah Barang');
        const beforeIncoming = await Product.getById(product.id);
        const incomingVariant = beforeIncoming.variants[0];
        await evaluate(`document.querySelectorAll('.incoming-item select')[1].value = '${product.id}:${incomingVariant.id}'; document.querySelectorAll('.incoming-item select')[1].dispatchEvent(new Event('change', {bubbles:true}))`);
        await fill('input[aria-label="Jumlah barang 2"]', 5);
        await fill('input[aria-label="Harga beli barang 2"]', 32000);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'incoming-form.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(650, 950);
            await new Promise(resolve => setTimeout(resolve, 350));
            assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'incoming-form-narrow.png'), (await window.webContents.capturePage()).toPNG());
            window.setSize(1280, 900);
        }
        await clickButton('Simpan Barang Masuk');
        await waitFor(`!document.querySelector('#incoming-form') && !!document.querySelector('button[title="Detail Barang Masuk"]')`);
        assert.equal((await Product.getById(wholesaleProduct.id)).stock, 111);
        assert.equal((await Product.getById(wholesaleProduct.id)).purchase_price, 7000);
        assert.equal((await Product.getById(product.id)).variants[0].stock, incomingVariant.stock + 5);
        assert.equal((await Product.getById(product.id)).variants[0].purchase_price, 32000);
        await evaluate(`document.querySelector('button[title="Detail Barang Masuk"]').click()`);
        await waitFor(`!!document.querySelector('#incoming-detail') && document.querySelector('#incoming-detail').innerText.includes('328.000')`);
        assert.ok(await evaluate(`document.querySelector('#incoming-detail').innerText.includes('Kaos UI - Merah / XL')`));
        await evaluate(`document.querySelector('#incoming-detail .modal-close').click()`);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'incoming-history.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Supplier');
        await waitFor(`!!document.querySelector('button[title="Edit Supplier"]')`);
        await evaluate(`document.querySelector('button[title="Edit Supplier"]').click()`);
        await waitFor(`!!document.querySelector('#supplier-name')`);
        await fill('#supplier-name', 'Supplier UI Baru');
        await evaluate(`document.querySelector('#incoming-supplier-modal input[type="checkbox"]').click()`);
        await clickButton('Simpan Supplier');
        await waitFor(`!document.querySelector('#incoming-supplier-modal') && document.querySelector('.incoming-suppliers').innerText.includes('Nonaktif')`);
        assert.equal((await db.get('SELECT active FROM suppliers WHERE id=?', [supplierId])).active, 0);
        await clickButton('Barang Masuk');
        await waitFor(`document.querySelector('.incoming-history')?.innerText.includes('Supplier UI')`);
        assert.equal((await db.get('SELECT supplier_name FROM stock_receipts ORDER BY id DESC LIMIT 1')).supplier_name, 'Supplier UI');
        console.log('PASS: inline supplier creation, mixed incoming stock, costs, receipt detail, supplier edit and immutable supplier snapshot through real IPC');
        await evaluate(`location.hash = '#/settings'`);
        await waitFor(`document.body.innerText.includes('Pulihkan Backup')`);
        await clickButton('Pulihkan Backup');
        await waitFor(`document.body.innerText.includes('Masuk Sekarang')`);
        assert.equal(await evaluate(`localStorage.getItem('pos_session')`), null);
        assert.equal((await db.get('SELECT COUNT(*) as count FROM orders')).count, 1);
        assert.equal((await db.get('SELECT COUNT(*) as count FROM stock_receipts')).count, 0);
        assert.ok((await fs.readdir(path.join(profile, 'backups'))).some(name => name.startsWith('sebelum-pemulihan-')));
        console.log('PASS: restore button restores the chosen backup, keeps a recovery copy and returns to login');
    } catch (error) {
        console.error(error);
        if (window) console.error('UI state:', await evaluate(`JSON.stringify({ url: location.href, body: document.body.innerText, session: localStorage.getItem('pos_session') })`));
        process.exitCode = 1;
    } finally {
        if (window) window.destroy();
        if (server) await server.close();
        if (db) await db.close();
        // The profile is temporary; Chromium may retain file handles until exit.
        await new Promise(resolve => setTimeout(resolve, 100));
        if (process.exitCode) app.exit(process.exitCode);
        else app.quit();
    }
});
