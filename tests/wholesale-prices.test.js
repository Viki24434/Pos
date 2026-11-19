import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
import { getSellingPrice, normalizeWholesalePrices } from '../shared/pricing.js';
import { migrateWholesalePrices } from '../config/wholesale-migration.js';

process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection } = await import('../config/db.js');
const Product = await import('../models/Product.js');
const Customer = await import('../models/Customer.js');
const Order = await import('../models/Order.js');

test('wholesale prices respect thresholds, VIP, and invalid configurations', () => {
    const product = { price: 10000, vip_price: 8500, wholesale_prices: [{ min_qty: 6, price: 9000 }, { min_qty: 12, price: 8000 }] };
    for (const [qty, regular, vip] of [[1, 10000, 8500], [5, 10000, 8500], [6, 9000, 8500], [11, 9000, 8500], [12, 8000, 8000], [24, 8000, 8000]]) {
        assert.equal(getSellingPrice(product, false, qty), regular);
        assert.equal(getSellingPrice(product, true, qty), vip);
    }
    assert.equal(getSellingPrice({ price: 10000 }, false, 100), 10000);
    assert.equal(getSellingPrice({ ...product, vip_price: 0 }, true, 12), 0);
    for (const tiers of [[{ min_qty: 1, price: 5 }], [{ min_qty: 2.5, price: 5 }], [{ min_qty: 2, price: -1 }], [{ min_qty: 2, price: '' }], [{ min_qty: 2, price: 11000 }], [{ min_qty: 2, price: 9000 }, { min_qty: 3, price: 9500 }], [{ min_qty: 2, price: 9000 }, { min_qty: 2, price: 8000 }]]) {
        assert.throws(() => normalizeWholesalePrices(tiers, 10000));
    }
    assert.deepEqual(normalizeWholesalePrices([...product.wholesale_prices].reverse(), 10000), product.wholesale_prices);
});

test('wholesale migration, stock, variants, stale checkout, and historical snapshots', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace(/ {2}wholesale_prices[^\n]*\n/g, ''));
    await migrateWholesalePrices(db);
    await migrateWholesalePrices(db);
    const tiers = [{ min_qty: 6, price: 9000 }, { min_qty: 12, price: 8000 }];
    const result = await Product.create({ name: 'Minyak', price: 10000, vip_price: 8500, stock: 100, wholesale_prices: tiers });
    let product = await Product.getById(result.lastID);
    assert.deepEqual(product.wholesale_prices, tiers);
    await assert.rejects(Order.createOrder('Umum', [{ product_id: product.id, qty: 6, price: 10000 }], 0, 0), /Harga/);
    assert.equal((await Product.getById(product.id)).stock, 100);
    const orderId = await Order.createOrder('Umum', [{ product_id: product.id, qty: 6, price: 9000 }], 0, 0);
    assert.equal((await Order.getOrderById(orderId)).total_amount, 54000);
    assert.equal((await Product.getById(product.id)).stock, 94);
    const vip = await Customer.addCustomer({ name: 'VIP', status: 'VIP' });
    const vipOrder = await Order.createOrder('', [{ product_id: product.id, qty: 12, price: 8000 }], 0, 0, vip.lastID);
    assert.equal((await Order.getOrderById(vipOrder)).total_amount, 96000);
    await assert.rejects(Product.update(product.id, { ...product, wholesale_prices: [{ min_qty: 6, price: 11000 }] }), /Harga grosir/);
    assert.deepEqual((await Product.getById(product.id)).wholesale_prices, tiers);
    product = await Product.getById(product.id);
    await Product.update(product.id, { ...product, wholesale_prices: [] });
    assert.equal((await Order.getOrderItems(orderId))[0].price, 9000);
    assert.equal((await Product.getById(product.id)).wholesale_prices.length, 0);
    const variantResult = await Product.create({ name: 'Biskuit', variants: [
        { name: 'Coklat', price: 10000, stock: 20, wholesale_prices: tiers },
        { name: 'Susu', price: 10000, stock: 20 },
    ] });
    const variantProduct = await Product.getById(variantResult.lastID);
    const variantsOrder = await Order.createOrder('Umum', variantProduct.variants.map((v, index) => ({ product_id: variantProduct.id, variant_id: v.id, qty: 6, price: index ? 10000 : 9000 })), 0, 0);
    assert.equal((await Order.getOrderById(variantsOrder)).total_amount, 114000);
    await Product.update(variantProduct.id, { ...variantProduct, variants: (await Product.getById(variantProduct.id)).variants.map(v => ({ ...v, wholesale_prices: undefined })) });
    assert.deepEqual((await Product.getById(variantProduct.id)).variants[0].wholesale_prices, tiers);
});
