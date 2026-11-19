import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { migrateIncomingStock } from '../config/incoming-migration.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-incoming-'));
process.env.APP_JS_DB_PATH = path.join(directory, 'active.sqlite');
const { getDbConnection } = await import('../config/db.js');
const Product = await import('../models/Product.js');
const Order = await import('../models/Order.js');
const Incoming = await import('../models/IncomingStock.js');
const { createBackup, restoreBackup } = await import('../models/Backup.js');

test('supplier receipts update stock and costs atomically, preserve history and survive restore', async t => {
    const db = await getDbConnection();
    t.after(async () => { await db.close(); await fs.rm(directory, { recursive: true, force: true }); });
    await db.exec(await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8'));
    await migrateIncomingStock(db);
    await migrateIncomingStock(db);
    await assert.rejects(Incoming.saveSupplier({ name: ' ' }), /Nama supplier/);
    const supplierId = await Incoming.saveSupplier({ name: '  Supplier Utama ', phone: '0800', address: 'Jalan Pasar' });
    assert.equal((await Incoming.getSuppliers())[0].name, 'Supplier Utama');
    const simple = await Product.create({ name: 'Minyak', price: 15000, purchase_price: 8000, stock: 2 });
    const variantResult = await Product.create({ name: 'Biskuit', price: 10000, purchase_price: 4000, variants: [
        { name: 'Coklat', price: 10000, purchase_price: 5000, stock: 1 }, { name: 'Susu', price: 10000, stock: 2 },
    ] });
    const variantProduct = await Product.getById(variantResult.lastID);
    const [coklat, susu] = variantProduct.variants;
    const oldOrder = await Order.createOrder('Umum', [{ product_id: simple.lastID, qty: 1, price: 15000 }], 0, 0);
    const form = { supplier_id: supplierId, user_id: 1, receipt_date: '2026-11-19', reference: 'NOTA-001', notes: 'Paket utuh', update_cost: true, request_id: 'incoming-1', items: [
        { product_id: simple.lastID, qty: 10, purchase_price: 9000 },
        { product_id: variantProduct.id, variant_id: coklat.id, qty: 4, purchase_price: 6000 },
        { product_id: variantProduct.id, variant_id: susu.id, qty: 3, purchase_price: 4500 },
    ] };
    const id = await Incoming.createReceipt(form);
    assert.equal(await Incoming.createReceipt(form), id);
    assert.equal((await Product.getById(simple.lastID)).stock, 11);
    assert.equal((await Product.getById(simple.lastID)).purchase_price, 9000);
    assert.equal((await Product.getById(simple.lastID)).cost_known, 1);
    assert.equal((await Order.getOrderItems(oldOrder))[0].purchase_price, 8000);
    assert.deepEqual((await Product.getById(variantProduct.id)).variants.map(v => [v.stock,v.purchase_price]), [[5,6000],[5,4500]]);
    assert.equal((await Product.getById(variantProduct.id)).stock, 10);
    assert.equal((await Incoming.getReceiptDetail(id)).total_amount, 127500);
    assert.equal((await Incoming.getReceiptDetail(id)).items.length, 3);
    const before = (await Incoming.getReceipts()).summary;
    const fresh = changes => ({ ...form, request_id: 'failure-' + Math.random(), reference: '', ...changes });
    await assert.rejects(Incoming.createReceipt(fresh({ reference: 'nota-001' })), /sudah dicatat/);
    for (const items of [
        [...form.items, { product_id: 99999, qty: 1, purchase_price: 1 }],
        [form.items[0], form.items[0]],
        [{ product_id: variantProduct.id, qty: 1, purchase_price: 1 }],
        [{ ...form.items[0], qty: 0 }], [{ ...form.items[0], qty: 1.5 }],
        [{ ...form.items[0], purchase_price: -1 }], [{ ...form.items[0], purchase_price: 1.001 }],
    ]) await assert.rejects(Incoming.createReceipt(fresh({ items })));
    assert.equal((await Product.getById(simple.lastID)).stock, 11);
    assert.deepEqual((await Incoming.getReceipts()).summary, before);
    await assert.rejects(Incoming.createReceipt(fresh({ receipt_date: '2026-02-30' })), /Tanggal/);
    await assert.rejects(Incoming.createReceipt(fresh({ user_id: 99999 })), /Pengguna/);
    await Incoming.saveSupplier({ id: supplierId, name: 'Nama Baru', active: 0 });
    await assert.rejects(Incoming.createReceipt(fresh({})), /aktif/);
    assert.equal((await Incoming.getReceiptDetail(id)).supplier_name, 'Supplier Utama');
    await Incoming.saveSupplier({ id: supplierId, name: 'Nama Baru', active: 1 });
    const noCost = await Incoming.createReceipt(fresh({ request_id: 'no-cost', update_cost: false, items: [{ product_id: simple.lastID, qty: 2, purchase_price: 10000 }] }));
    assert.equal((await Incoming.getReceiptDetail(noCost)).update_cost, 0);
    assert.equal((await Product.getById(simple.lastID)).stock, 13);
    assert.equal((await Product.getById(simple.lastID)).purchase_price, 9000);
    assert.equal((await Incoming.getReceipts({ search: 'NOTA-001' })).rows[0].id, id);
    assert.equal((await Incoming.getReceipts({ search: 'Supplier Utama' })).rows.length, 1);
    assert.equal((await Incoming.getReceipts({ start: '2026-11-20' })).rows.length, 0);
    await assert.rejects(Incoming.getReceipts({ start: '2026-11-20', end: '2026-11-19' }), /Tanggal/);
    await db.run("INSERT INTO stores (id,name) VALUES (2,'Lain')");
    await db.run("INSERT INTO suppliers (store_id,name) VALUES (2,'Supplier Lain')");
    const other = await db.get("SELECT id FROM suppliers WHERE name='Supplier Lain'");
    await assert.rejects(Incoming.saveSupplier({ id: other.id, name: 'Tidak boleh' }), /tidak ditemukan/);
    await assert.rejects(Incoming.createReceipt(fresh({ supplier_id: other.id })), /aktif/);
    assert.equal((await Incoming.getSuppliers()).length, 1);

    const backup = path.join(directory, 'snapshot.sqlite');
    await createBackup(backup);
    await Incoming.createReceipt(fresh({ request_id: 'after-backup', items: [{ product_id: simple.lastID, qty: 1, purchase_price: 11000 }] }));
    await restoreBackup(backup, directory);
    assert.equal((await Product.getById(simple.lastID)).stock, 13);
    assert.equal((await Incoming.getReceipts()).rows.length, 2);
    assert.equal((await Incoming.getReceiptDetail(id)).items[1].item_name, 'Biskuit - Coklat');
    assert.equal((await db.all('PRAGMA foreign_key_check')).length, 0);
});
