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

let server;
let window;
let profile;
let db;
let savedPayload;
let orderPayload;

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
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
        input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
}

app.whenReady().then(async () => {
    try {
        profile = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-variants-ui-'));
        app.setPath('userData', profile);
        await inisialisasiDatabase();
        db = await getDbConnection();
        const { createServer } = await import('vite');
        server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: 0 } });
        await server.listen();
        ipcMain.handle('check-activation', () => true);
        ipcMain.handle('get-settings', () => ({ name: 'Test' }));
        ipcMain.handle('get-ip-address', () => '127.0.0.1');
        ipcMain.handle('get-products', () => Product.getAll());
        ipcMain.handle('get-categories', () => []);
        ipcMain.handle('get-units', () => []);
        ipcMain.handle('get-orders', () => []);
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
        ipcMain.handle('create-order', async (_event, payload) => {
            orderPayload = payload;
            return Order.createOrder(payload.customerName, payload.items, 0, payload.discount, 0,
                { amount: payload.amountPaid, method: payload.paymentMethod, user_id: 1 });
        });
        const isolatedSession = session.fromPartition(`variants-ui-${Date.now()}`);
        window = new BrowserWindow({ show: false, width: 1280, height: 900,
            webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), session: isolatedSession, backgroundThrottling: false, offscreen: true } });
        window.webContents.on('console-message', event => {
            if (event.level === 'error') console.error('Renderer:', event.message);
        });
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
        await clickButton('Tambah Varian');
        await fill('.variant-editor-row:nth-child(3) input', 'Biru / L');
        await fill('.variant-editor-row:nth-child(3) input[type="number"]', 55000);
        await fill('.variant-editor-row:nth-child(3) input[step="1"]', 3);
        if (process.env.APP_JS_UI_SCREENSHOTS) {
            await fs.mkdir(process.env.APP_JS_UI_SCREENSHOTS, { recursive: true });
            await new Promise(resolve => setTimeout(resolve, 350));
            await fs.writeFile(path.join(process.env.APP_JS_UI_SCREENSHOTS, 'variant-form.png'), (await window.webContents.capturePage()).toPNG());
        }
        await clickButton('Simpan Produk');
        await waitFor(`!document.querySelector('#modal-product') && document.body.innerText.includes('Kaos UI')`);
        assert.equal(savedPayload.variants.length, 2);
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
        await clickButton('Proses Pembayaran');
        await waitFor(`document.body.innerText.includes('Riwayat Pesanan')`);
        assert.equal(orderPayload.items.length, 2);
        assert.notEqual(orderPayload.items[0].variant_id, orderPayload.items[1].variant_id);
        assert.equal(orderPayload.grandTotal, 170000);
        assert.deepEqual((await Product.getById(product.id)).variants.map(variant => variant.stock), [4, 1]);
        const order = await db.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
        assert.equal(order.payment_status, 'Lunas');
        assert.equal((await Order.getOrderItems(order.id)).length, 2);
        console.log('PASS: cashier keeps variants separate, changes quantities, and completes paid checkout');
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
        app.exit(process.exitCode || 0);
    }
});
