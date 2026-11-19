import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
import { migrateOrderNotes } from '../config/order-notes-migration.js';

process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection } = await import('../config/db.js');
const Order = await import('../models/Order.js');
const Product = await import('../models/Product.js');

test('legacy orders and new orders support optional multiline notes', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace("  notes TEXT NOT NULL DEFAULT '',", ''));
    await db.run("INSERT INTO orders (store_id, customer_id, invoice_number, customer_name, total_amount) VALUES (1, 0, 'OLD', 'Umum', 0)");
    await migrateOrderNotes(db);
    await migrateOrderNotes(db);
    assert.equal((await db.get("SELECT notes FROM orders WHERE invoice_number = 'OLD'")).notes, '');
    const product = await Product.create({ name: 'Cetak', price: 10000, stock: 5 });
    const items = [{ product_id: product.lastID, qty: 1, price: 10000 }];
    const id = await Order.createOrder('Budi', items, 0, 0, 0, null, '  Laminasi doff\nPotong ukuran A5  ');
    assert.equal((await Order.getOrderById(id)).notes, 'Laminasi doff\nPotong ukuran A5');
    assert.equal((await Order.getAllOrders({})).find(order => order.id === id).notes, 'Laminasi doff\nPotong ukuran A5');
    const noNotes = await Order.createOrder('Umum', items, 0, 0);
    assert.equal((await Order.getOrderById(noNotes)).notes, '');
    const stock = (await Product.getById(product.lastID)).stock;
    await assert.rejects(Order.createOrder('Umum', items, 0, 0, 0, null, {}), /Catatan pesanan/);
    assert.equal((await Product.getById(product.lastID)).stock, stock);
});
