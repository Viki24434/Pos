// Run with: npx electron tests/ui-smoke.cjs
// Uses a hidden, isolated Electron window and an in-memory database.
const { app, BrowserWindow, ipcMain: rawIpcMain, session } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
process.env.APP_JS_DB_PATH = ':memory:';
const { ipcMain } = require('../electron/access-control.cjs').createAccessControl(rawIpcMain);
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
const { registerExpiryHandlers } = require('../electron/expiry-handlers.cjs');
const { registerBarcodeHandlers } = require('../electron/barcode-handlers.cjs');
const sharp = require('sharp');

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

async function checkDashboardStatus(order,status) {
    await evaluate(`location.hash='#/'`);
    const row=`Array.from(document.querySelectorAll('.dash-wrapper tbody tr')).find(row=>row.innerText.includes(${JSON.stringify(order.invoice_number)}))`;
    await waitFor(`${row}?.querySelector('.badge-pill')?.textContent===${JSON.stringify(status)}`);
    await evaluate(`location.hash='#/orders'`);
    await waitFor(`document.body.innerText.includes('Riwayat Pesanan') && Array.from(document.querySelectorAll('tbody tr')).some(row=>row.innerText.includes(${JSON.stringify(order.invoice_number)}))`);
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
        const barcodePath = path.join(profile,'barcode-test.png');
        registerBarcodeHandlers(ipcMain,{BrowserWindow,dialog:{showSaveDialog:async()=>({canceled:false,filePath:barcodePath})}});
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
        ipcMain.handle('get-dashboard-data', async () => ({ omzet:0, laba:0, transaksi:0, piutang:0, lowStocks:[], recentOrders:await db.all('SELECT invoice_number,customer_name,total_amount,payment_status,created_at FROM orders ORDER BY created_at DESC,id DESC LIMIT 5'), topProducts:[], chartLabels:[], chartData:[] }));
        ipcMain.handle('get-products', () => Product.getAll());
        ipcMain.handle('get-categories', () => []);
        ipcMain.handle('get-units', () => []);
        registerPaymentHandlers(ipcMain);
        registerIncomingHandlers(ipcMain);
        registerExpiryHandlers(ipcMain);
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
        assert.equal((await evaluate(`window.api.login({username:'admin',password:'admin'})`)).success, true);
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

        await evaluate(`location.hash='#/settings'`);
        await waitFor(`!!document.querySelector('#barcode-width') && !document.querySelector('.barcode-settings-fieldset').disabled`);
        await waitFor(`document.querySelector('.barcode-settings-preview img')?.naturalWidth===400`);
        const barcodeSettingsBeforePreview=(await db.get('SELECT barcode_settings FROM stores WHERE id=1')).barcode_settings;
        await fill('#barcode-width',640);
        await fill('#barcode-height',300);
        await waitFor(`document.querySelector('.barcode-settings-preview img')?.naturalWidth===640 && document.querySelector('.barcode-settings-preview img')?.naturalHeight===300 && document.querySelector('.barcode-settings-preview').getAttribute('aria-busy')==='false'`);
        const firstBarcodePreview=await evaluate(`document.querySelector('.barcode-settings-preview img').src`);
        await evaluate(`for(const key of ['show_variant','show_price','show_store','show_category','show_unit']){const input=document.querySelector('#barcode-'+key);if(!input.checked)input.click();}`);
        await fill('#barcode-custom-text','Terima kasih');
        await waitFor(`document.querySelector('.barcode-settings-preview img')?.src!==${JSON.stringify(firstBarcodePreview)} && document.querySelector('.barcode-settings-preview').getAttribute('aria-busy')==='false'`);
        assert.equal((await db.get('SELECT barcode_settings FROM stores WHERE id=1')).barcode_settings,barcodeSettingsBeforePreview);
        await fill('#barcode-height',30);
        await waitFor(`document.querySelector('.barcode-settings-card').innerText.includes('Tinggi harus')`);
        await fill('#barcode-height',300);
        await waitFor(`!!document.querySelector('.barcode-settings-preview img') && document.querySelector('.barcode-settings-preview').getAttribute('aria-busy')==='false' && !document.querySelector('.barcode-settings-card').innerText.includes('Tinggi harus')`);
        console.log('PASS: initial automatic barcode preview, live dimensions and content updates, invalid-size recovery, and unsaved settings preservation');
        const dragBarcodeElement=async(key,dx,dy)=>{
            await evaluate(`(()=>{const node=document.querySelector('[data-barcode-element="${key}"]');const rect=node.getBoundingClientRect();const x=rect.x+rect.width/2,y=rect.y+rect.height/2;node.dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,button:0,buttons:1,clientX:x,clientY:y,bubbles:true}));node.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,button:0,buttons:1,clientX:x+${dx},clientY:y+${dy},bubbles:true}));node.dispatchEvent(new PointerEvent('pointerup',{pointerId:9,button:0,buttons:0,clientX:x+${dx},clientY:y+${dy},bubbles:true}));})()`);
            await waitFor(`document.querySelector('.barcode-settings-preview').getAttribute('aria-busy')==='false'`);
        };
        await dragBarcodeElement('name',-40,0);
        assert.ok(await evaluate(`parseFloat(document.querySelector('[data-barcode-element="name"]').style.left)<49`));
        await clickButton('Reset Posisi');
        await waitFor(`document.querySelector('.barcode-settings-preview').getAttribute('aria-busy')==='false' && Math.abs(parseFloat(document.querySelector('[data-barcode-element="name"]').style.left)-50)<.2`);
        await dragBarcodeElement('name',-40,0);
        await dragBarcodeElement('variant',30,0);
        await dragBarcodeElement('barcode',1,0);
        console.log('PASS: label drag-and-drop moves product, variant and barcode, reset restores defaults, and live preview keeps matching the layout');
        await clickButton('Simpan Pengaturan Barcode');
        await waitFor(`document.querySelector('.barcode-settings-card').innerText.includes('Pengaturan barcode tersimpan.')`);
        const savedBarcodeSettings=JSON.parse((await db.get('SELECT barcode_settings FROM stores WHERE id=1')).barcode_settings);
        assert.equal(savedBarcodeSettings.width,640);assert.equal(savedBarcodeSettings.show_variant,true);assert.equal(savedBarcodeSettings.show_price,true);
        assert.ok(savedBarcodeSettings.positions.name.x<.5);assert.ok(savedBarcodeSettings.positions.variant.x>.5);
        if(process.env.APP_JS_UI_SCREENSHOTS){
            await evaluate(`document.querySelector('.barcode-settings-card').scrollIntoView({block:'center'})`);
            await new Promise(resolve=>setTimeout(resolve,350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'barcode-settings.png'),(await window.webContents.capturePage()).toPNG());
        }
        await evaluate(`location.hash='#/products'`);
        await waitFor(`!!document.querySelector('button[title="Buat Barcode"]')`);
        await evaluate(`document.querySelector('button[title="Buat Barcode"]').click()`);
        await waitFor(`!!document.querySelector('#barcode-label-modal .barcode-preview img')`);
        assert.equal(await evaluate(`!!document.querySelector('#barcode-label-modal #barcode-width')`),false);
        await waitFor(`document.querySelector('#barcode-label-modal .barcode-image-info')?.textContent.includes('640 × 300')`);
        await evaluate(`document.querySelector('#barcode-label-variant').value='${product.variants[0].id}';document.querySelector('#barcode-label-variant').dispatchEvent(new Event('change',{bubbles:true}))`);
        await waitFor(`document.querySelector('#barcode-label-modal').innerText.includes('Buat Kode Varian') && !document.querySelector('#barcode-label-modal [aria-busy="true"]')`);
        await clickButton('Buat Kode Varian');
        await waitFor(`!!document.querySelector('#barcode-label-modal .barcode-preview img') && !document.querySelector('#barcode-label-modal [aria-busy="true"]')`);
        const generatedSku=(await Product.getById(product.id)).variants[0].sku;
        assert.match(generatedSku,/^V-/);
        await clickButton('Simpan PNG');
        await waitFor(`document.querySelector('#barcode-label-modal').innerText.includes('Gambar barcode tersimpan.')`);
        const barcodeMeta=await sharp(barcodePath).metadata();
        assert.equal(barcodeMeta.width,640);assert.equal(barcodeMeta.height,300);
        assert.equal((await evaluate(`window.api.previewProductBarcode({product_id:${product.id},variant_id:${product.variants[0].id},width:120,height:80})`)).width,640);
        if(process.env.APP_JS_UI_SCREENSHOTS){
            await new Promise(resolve=>setTimeout(resolve,350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'barcode-label.png'),(await window.webContents.capturePage()).toPNG());
        }
        await evaluate(`document.querySelector('#barcode-label-modal .modal-close').click()`);
        console.log('PASS: barcode preview, custom dimensions, stable generated variant SKU and native PNG save');

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
        await fill('#barcode-scan',generatedSku);
        await evaluate(`document.querySelector('#barcode-scan').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
        await waitFor(`document.querySelector('.qty-stepper').textContent.includes('2')`);
        assert.equal(await evaluate(`document.querySelector('#barcode-scan').value`),'');
        await evaluate(`document.querySelector('.qty-stepper button:first-child').click()`);
        await fill('#barcode-scan','NOT-REGISTERED');
        await evaluate(`document.querySelector('#barcode-scan').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
        await waitFor(`document.querySelector('.barcode-scan-status').textContent.includes('belum terdaftar')`);
        await clickButton('Scan');
        await waitFor(`!!document.querySelector('#barcode-scanner-modal')`);
        await evaluate(`window.__originalMedia=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('Denied','NotAllowedError')}}})`);
        await clickButton('Mulai Kamera');
        await waitFor(`document.querySelector('#barcode-scanner-modal').innerText.includes('Akses kamera ditolak')`);
        const barcodeBase64=(await fs.readFile(barcodePath)).toString('base64');
        await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(barcodeBase64)}),char=>char.charCodeAt(0))],'barcode.png',{type:'image/png'}));const input=document.querySelector('#barcode-image-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await waitFor(`!document.querySelector('#barcode-scanner-modal') && document.querySelector('.qty-stepper').textContent.includes('2')`);
        await waitFor(`document.activeElement===document.querySelector('#barcode-scan')`);
        await evaluate(`Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:window.__originalMedia});delete window.__originalMedia;document.querySelector('.qty-stepper button:first-child').click()`);
        await fill('#barcode-scan',product.code);
        await evaluate(`document.querySelector('#barcode-scan').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
        await waitFor(`document.querySelectorAll('.variant-option').length===2`);
        await evaluate(`document.querySelector('.variant-option').click()`);
        await waitFor(`document.querySelector('.qty-stepper').textContent.includes('2')`);
        await evaluate(`document.querySelector('.qty-stepper button:first-child').click()`);
        console.log('PASS: keyboard scanner increments exact variants, unknown codes do not add items, camera denial recovers, and saved PNG scans back into the cart');
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
        await checkDashboardStatus(order,'Lunas');
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
        await checkDashboardStatus(depositOrder,'DP');
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
        await checkDashboardStatus(unpaid,'Belum Bayar');
        console.log('PASS: dashboard displays paid, deposit and unpaid status badges from database orders');
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
        assert.equal((await evaluate(`window.api.login({username:'admin',password:'admin'})`)).success, true);
        await window.loadURL(`${server.resolvedUrls.local[0]}?legacy-api=2#/orders/create`);
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
        await evaluate(`document.querySelector('.incoming-expiry summary').click()`);
        const {expiry:incomingExpiry}=await db.get("SELECT DATE('now','localtime','+7 day') as expiry");
        await fill('input[aria-label="Nomor batch barang 1"]','LOT-UI');
        await fill('input[aria-label="Kedaluwarsa barang 1"]',incomingExpiry);
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

        await evaluate(`document.querySelector('a[href="#/expiry"]').click()`);
        await waitFor(`!!document.querySelector('#expiry-search') && document.querySelector('.expiry-table').innerText.includes('LOT-UI')`);
        await fill('#expiry-search','Minyak Grosir UI');
        await evaluate(`document.querySelector('#expiry-status').value='all';document.querySelector('#expiry-status').dispatchEvent(new Event('change',{bubbles:true}))`);
        await clickButton('Cari');
        await waitFor(`document.querySelectorAll('.expiry-table tbody tr').length===2`);
        await evaluate(`Array.from(document.querySelectorAll('.expiry-table tbody tr')).find(row=>row.innerText.includes('LOT-UI')).querySelector('button[title="Atur Kedaluwarsa"]').click()`);
        await waitFor(`!!document.querySelector('#expiry-quantity')`);
        await fill('#expiry-quantity',3);
        await fill('#expiry-code','LOT-EXPIRED');
        await fill('#expiry-date',yesterday);
        await clickButton('Simpan Batch');
        await waitFor(`!document.querySelector('#expiry-modal') && document.querySelector('.expiry-table').innerText.includes('LOT-EXPIRED')`);
        assert.equal((await Product.getById(wholesaleProduct.id)).stock,111);
        assert.equal((await Product.getById(wholesaleProduct.id)).sellable_stock,108);
        if(process.env.APP_JS_UI_SCREENSHOTS){
            await new Promise(resolve=>setTimeout(resolve,350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'expiry-desktop.png'),(await window.webContents.capturePage()).toPNG());
            window.setSize(650,950);
            await new Promise(resolve=>setTimeout(resolve,350));
            assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'expiry-narrow.png'),(await window.webContents.capturePage()).toPNG());
            window.setSize(1280,900);
        }
        await evaluate(`document.querySelector('#expiry-status').value='expired';document.querySelector('#expiry-status').dispatchEvent(new Event('change',{bubbles:true}))`);
        await clickButton('Cari');
        await waitFor(`document.querySelectorAll('.expiry-table tbody tr').length===1 && document.querySelector('.expiry-table').innerText.includes('LOT-EXPIRED')`);
        await evaluate(`document.querySelector('button[title="Keluarkan Stok Batch"]').click()`);
        await waitFor(`!!document.querySelector('#expiry-reason')`);
        await fill('#expiry-quantity',1);
        await evaluate(`document.querySelector('#expiry-modal button[type="submit"]').click()`);
        await waitFor(`!document.querySelector('#expiry-modal') && document.body.innerText.includes('Stok batch sudah dikeluarkan.')`);
        assert.equal((await Product.getById(wholesaleProduct.id)).stock,110);
        assert.equal((await Product.getById(wholesaleProduct.id)).sellable_stock,108);
        assert.equal((await db.get('SELECT qty FROM batch_removals ORDER BY id DESC LIMIT 1')).qty,1);
        console.log('PASS: optional receipt expiry, batch split without stock addition, expired filter, disposal and sellable-stock exclusion');

        await evaluate(`document.querySelector('a[href="#/users"]').click()`);
        await waitFor(`document.body.innerText.includes('Pengaturan User') && !!document.querySelector('button[title="Edit Hak Akses"]')`);
        await clickButton('Tambah Akun');
        await waitFor(`!!document.querySelector('#user-name')`);
        await fill('#user-name', 'Kasir UI');
        await fill('#user-username', 'kasir-ui');
        await fill('#user-password', 'kasir123');
        assert.equal(await evaluate(`document.querySelector('[data-permission="sales.discount"]').checked`), false);
        assert.equal(await evaluate(`document.querySelector('[data-permission="reports.view"]').checked`), false);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve,350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'user-permissions.png'),(await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Akun');
        await waitFor(`!document.querySelector('#modal-user') && document.body.innerText.includes('Kasir UI')`);
        const cashierAccount = await db.get("SELECT id FROM users WHERE username='kasir-ui'");
        assert.ok(cashierAccount.id > 1);
        await evaluate(`Array.from(document.querySelectorAll('.users-page tbody tr')).find(row=>row.innerText.includes('(Anda)')).querySelector('button').click()`);
        await waitFor(`!!document.querySelector('#user-active')`);
        await evaluate(`document.querySelector('#user-active').click()`);
        await clickButton('Simpan Akun');
        await waitFor(`document.querySelector('#modal-user')?.innerText.includes('Minimal satu Super Admin')`);
        await evaluate(`document.querySelector('#modal-user .modal-close').click()`);
        await evaluate(`document.querySelector('.sidebar-logout a').click()`);
        await waitFor(`document.body.innerText.includes('Masuk Sekarang')`);
        await fill('input[placeholder="Masukkan username"]','kasir-ui');
        await fill('input[placeholder="Masukkan password"]','kasir123');
        await clickButton('Masuk Sekarang');
        await waitFor(`location.hash === '#/orders/create' && document.querySelectorAll('.product-tile').length === 2`);
        for (const target of ['users','reports','products','finance','settings','incoming-stock','expiry']) assert.equal(await evaluate(`!!document.querySelector('a[href="#/${target}"]')`),false);
        assert.equal(await evaluate(`!!document.querySelector('.discount-input')`),false);
        const cashierProducts=await evaluate(`window.api.getProducts()`);
        assert.equal('purchase_price' in cashierProducts[0],false);
        const rejected=await evaluate(`window.api.getUsers().then(()=>false,error=>error.message)`);
        assert.match(rejected,/hak akses/);
        await evaluate(`localStorage.setItem('pos_session',JSON.stringify({id:1,role:'Super Admin'}));location.hash='#/reports'`);
        await waitFor(`location.hash === '#/orders/create'`);
        await evaluate(`location.reload()`);
        await waitFor(`location.hash === '#/orders/create' && document.querySelectorAll('.product-tile').length === 2`);
        assert.equal(await evaluate(`!!document.querySelector('a[href="#/users"]')`),false);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await new Promise(resolve => setTimeout(resolve,350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS,'cashier-access.png'),(await window.webContents.capturePage()).toPNG());
        }
        await evaluate(`window.alert=()=>{};Array.from(document.querySelectorAll('.product-tile')).find(tile=>tile.innerText.includes('Minyak Grosir UI')).click()`);
        await waitFor(`document.querySelectorAll('.qty-stepper').length===1`);
        await clickButton('Bayar Sekarang');
        await waitFor(`!!document.querySelector('#checkout-payment #payment-method option[value="Cash"]')`);
        await clickButton('Simpan Pesanan & Pembayaran');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan')`);
        const cashierOrder=await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(cashierOrder.user_id,cashierAccount.id);
        assert.equal((await db.get('SELECT user_id FROM payments WHERE order_id=?',[cashierOrder.id])).user_id,cashierAccount.id);
        assert.equal((await db.get('SELECT b.batch_code FROM order_item_batches a JOIN inventory_batches b ON b.id=a.batch_id JOIN order_items i ON i.id=a.order_item_id WHERE i.order_id=?',[cashierOrder.id])).batch_code,'LOT-UI');
        await evaluate(`document.querySelector('.sidebar-logout a').click()`);
        await waitFor(`document.body.innerText.includes('Masuk Sekarang')`);
        await fill('input[placeholder="Masukkan username"]','admin');
        await fill('input[placeholder="Masukkan password"]','admin');
        await clickButton('Masuk Sekarang');
        await waitFor(`!!document.querySelector('a[href="#/settings"]')`);
        console.log('PASS: user account form, protected final owner, real cashier login, hidden restricted menus, denied IPC, forged storage rejection, and attributed checkout');
        await evaluate(`location.hash = '#/settings'`);
        await waitFor(`document.body.innerText.includes('Pulihkan Backup')`);
        await clickButton('Pulihkan Backup');
        await waitFor(`document.body.innerText.includes('Masuk Sekarang')`);
        assert.equal(await evaluate(`localStorage.getItem('pos_session')`), null);
        assert.equal((await db.get('SELECT COUNT(*) as count FROM orders')).count, 1);
        assert.equal((await db.get('SELECT COUNT(*) as count FROM stock_receipts')).count, 0);
        assert.equal(JSON.parse((await db.get('SELECT barcode_settings FROM stores WHERE id=1')).barcode_settings).width,640);
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
