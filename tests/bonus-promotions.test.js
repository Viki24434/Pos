import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
import { createRequire } from 'node:module';
import { getBonusQuantity, normalizeBonusPromotion } from '../shared/promotions.js';
import { migrateBonusPromotions } from '../config/bonus-migration.js';

process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection } = await import('../config/db.js');
const Product = await import('../models/Product.js');
const Customer = await import('../models/Customer.js');
const Order = await import('../models/Order.js');
const Report = await import('../models/Report.js');
const { getReceiptData, renderReceipt } = createRequire(import.meta.url)('../electron/receipt.cjs');

test('bonus promotions repeat on paid quantities and validate configuration', () => {
    const promo = { buy_qty: 4, free_qty: 1 };
    for (const [qty, bonus] of [[1, 0], [3, 0], [4, 1], [7, 1], [8, 2], [12, 3]]) assert.equal(getBonusQuantity(promo, qty), bonus);
    assert.equal(getBonusQuantity({}, 100), 0);
    assert.equal(getBonusQuantity({ buy_qty: 2, free_qty: 3 }, 4), 6);
    for (const value of [{ buy_qty: 1 }, { free_qty: 1 }, { buy_qty: -1, free_qty: 1 }, { buy_qty: 1.5, free_qty: 1 }, { buy_qty: 2, free_qty: '' }]) assert.throws(() => normalizeBonusPromotion(value));
    assert.throws(() => getBonusQuantity({ buy_qty: 1, free_qty: 2 }, Number.MAX_SAFE_INTEGER), /terlalu besar/);
});

test('bonus orders preserve stock, cost, receipts, and historical free items', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace(/ {2}(?:buy_qty|free_qty|is_free)[^\n]*\n/g, ''));
    await db.run("INSERT INTO products (store_id,name,price,stock) VALUES(1,'Lama',100,0)");
    await migrateBonusPromotions(db);
    await migrateBonusPromotions(db);
    assert.deepEqual(await db.get("SELECT buy_qty,free_qty FROM products WHERE name='Lama'"), { buy_qty: 0, free_qty: 0 });
    const created = await Product.create({ name: 'Sabun', price: 10000, purchase_price: 5000, stock: 30, buy_qty: 4, free_qty: 1,
        vip_price: 8500, wholesale_prices: [{ min_qty: 8, price: 8000 }] });
    let product = await Product.getById(created.lastID);
    assert.equal(product.buy_qty, 4);
    const item = { product_id: product.id, qty: 8, price: 8000, bonus_qty: 2 };
    await assert.rejects(Order.createOrder('Umum', [{ ...item, bonus_qty: 99 }], 0, 0), /Promo/);
    assert.equal((await Product.getById(product.id)).stock, 30);
    const vip = await Customer.addCustomer({ name: 'VIP', status: 'VIP' });
    const id = await Order.createOrder('', [item], 0, 0, vip.lastID);
    const order = await Order.getOrderById(id);
    assert.equal(order.total_amount, 64000);
    assert.equal((await Product.getById(product.id)).stock, 20);
    const items = await Order.getOrderItems(id);
    assert.equal(items.length, 2);
    assert.deepEqual(items.map(row => [row.qty, row.price, row.subtotal, row.purchase_price, row.is_free]), [[8, 8000, 64000, 5000, 0], [2, 0, 0, 5000, 1]]);
    assert.match(items[1].item_name, /Gratis/);
    const report = (await Report.getSalesProfitReport()).rows.find(row => row.id === id);
    assert.equal(report.recorded_cost, 50000);
    assert.equal(report.gross_profit, 14000);
    const html = renderReceipt(await getReceiptData(id));
    assert.ok(html.includes('Sabun (Gratis)'));
    assert.ok(html.includes('2 x Rp 0'));
    await assert.rejects(Product.update(product.id, { ...product, buy_qty: 0, free_qty: 1 }), /Jumlah beli/);
    assert.equal((await Product.getById(product.id)).buy_qty, 4);
    product = await Product.getById(product.id);
    await Product.update(product.id, { ...product, buy_qty: 0, free_qty: 0 });
    assert.equal((await Product.getById(product.id)).free_qty, 0);
    assert.equal((await Order.getOrderItems(id))[1].qty, 2);

    const variantResult = await Product.create({ name: 'Minuman', purchase_price: 4000, variants: [
        { name: 'Jeruk', price: 10000, purchase_price: 3000, stock: 5, buy_qty: 2, free_qty: 1 },
        { name: 'Apel', price: 10000, stock: 5 },
    ] });
    const variantProduct = await Product.getById(variantResult.lastID);
    const [jeruk, apel] = variantProduct.variants;
    const variantItem = { product_id: variantProduct.id, variant_id: jeruk.id, qty: 4, bonus_qty: 2, price: 10000 };
    await assert.rejects(Order.createOrder('Umum', [variantItem], 0, 0), /Stok/);
    assert.equal((await Product.getById(variantProduct.id)).stock, 10);
    const countBefore = (await db.get('SELECT COUNT(*) AS count FROM orders')).count;
    await assert.rejects(Order.createOrder('Umum', [{ ...variantItem, qty: 2, bonus_qty: 1 }, { ...variantItem, qty: 2, bonus_qty: 1 }], 0, 0), /Stok/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM orders')).count, countBefore);
    assert.equal((await Product.getById(variantProduct.id)).variants[0].stock, 5);
    const variantOrder = await Order.createOrder('Umum', [{ ...variantItem, qty: 2, bonus_qty: 1 }, { product_id: variantProduct.id, variant_id: apel.id, qty: 2, price: 10000 }], 0, 0);
    assert.equal((await Order.getOrderItems(variantOrder)).length, 3);
    assert.deepEqual((await Product.getById(variantProduct.id)).variants.map(row => row.stock), [2, 3]);
    assert.equal((await Product.getById(variantProduct.id)).stock, 5);
    await Product.update(variantProduct.id, { ...(await Product.getById(variantProduct.id)), variants: (await Product.getById(variantProduct.id)).variants.map(({ buy_qty, free_qty, ...row }) => row) });
    assert.equal((await Product.getById(variantProduct.id)).variants[0].free_qty, 1);
});
