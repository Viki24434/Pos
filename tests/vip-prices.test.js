import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection } = await import('../config/db.js');
const Product = await import('../models/Product.js');
const Customer = await import('../models/Customer.js');
const Order = await import('../models/Order.js');
const { migrateVipPrices } = await import('../config/vip-migration.js');
test('VIP prices are optional, validated and applied per variant', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace(/ {2}vip_price[^\n]*\n/g, ''));
    await migrateVipPrices(db);
    await migrateVipPrices(db);
    const vip = await Customer.addCustomer({ name: 'VIP', status: 'VIP' });
    const member = await Customer.addCustomer({ name: 'Member', status: 'Member' });
    const result = await Product.create({ name: 'Produk VIP', price: 100, vip_price: 80, stock: 10 });
    const item = { product_id: result.lastID, price: 80, qty: 1 };
    const order = await Order.createOrder('', [item], 0, 0, vip.lastID);
    assert.equal((await Order.getOrderById(order)).total_amount, 80);
    await assert.rejects(Order.createOrder('', [item], 0, 0, member.lastID), /Harga/);
    await assert.rejects(Order.createOrder('', [item], 0, 0), /Harga/);
    let product = await Product.getById(result.lastID);
    await Product.update(product.id, { ...product, vip_price: '' });
    const regular = await Order.createOrder('', [{ ...item, price: 100 }], 0, 0, vip.lastID);
    assert.equal((await Order.getOrderById(regular)).total_amount, 100);
    const variants = await Product.create({ name: 'Varian VIP', variants: [
        { name: 'VIP khusus', price: 100, vip_price: 70, stock: 5 },
        { name: 'Biasa', price: 90, stock: 5 },
        { name: 'Gratis VIP', price: 50, vip_price: 0, stock: 5 },
    ] });
    product = await Product.getById(variants.lastID);
    const id = await Order.createOrder('', product.variants.map((variant, index) => ({ product_id: product.id, variant_id: variant.id, qty: 1, price: [70, 90, 0][index] })), 0, 0, vip.lastID);
    assert.equal((await Order.getOrderById(id)).total_amount, 160);
    await Product.update(product.id, { ...product, variants: product.variants.map(v => ({ ...v, stock: 4 })) });
    assert.equal((await Product.getById(product.id)).variants[0].vip_price, 70);
    await assert.rejects(Product.update(product.id, { ...product, variants: [{ name: 'Invalid', price: 100, vip_price: -1, stock: 4 }] }), /Harga VIP/);
    assert.equal((await Order.getOrderItems(id))[0].price, 70);
});
