import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';

// Never use the shop database for tests.
process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection, migrateProductVariants } = await import('../config/db.js');
const Product = await import('../models/Product.js');
const { migrateVipPrices } = await import('../config/vip-migration.js');
const { migrateCosts } = await import('../config/cost-migration.js');
const Order = await import('../models/Order.js');

test('product variants and order stock integration', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    // Begin with the old order_items shape to exercise the upgrade path.
    await db.exec(schema.replace(/ {2}variant_(?:id|name|sku) .*\r?\n/g, '')
        .replace(/CREATE TABLE IF NOT EXISTS product_variants \([\s\S]*?CREATE INDEX IF NOT EXISTS idx_product_variants_product[^;]*;/, ''));
    await migrateProductVariants(db);
    await migrateVipPrices(db);
    await migrateCosts(db);
    await migrateProductVariants(db);
    const columns = await db.all('PRAGMA table_info(order_items)');
    assert.equal(columns.filter(column => column.name.startsWith('variant_')).length, 3);
    let product;
    let orderId;

    await t.test('create and read variants with aggregate stock and minimum price', async () => {
        const result = await Product.create({ name: 'Kaos', code: 'KAOS', variants: [
            { name: 'Merah / XL', sku: 'K-M-XL', price: 60000, stock: 5 },
            { name: 'Biru / L', sku: 'K-B-L', price: 55000, stock: 3 },
        ] });
        product = await Product.getById(result.lastID);
        assert.equal(product.code, 'KAOS');
        assert.equal(product.stock, 8);
        assert.equal(product.price, 55000);
        assert.equal(product.variants.length, 2);
        assert.equal((await Product.getAll())[0].variants[0].sku, 'K-M-XL');
    });

    await t.test('different variants of the same product retain separate prices and quantities', async () => {
        orderId = await Order.createOrder('Test', product.variants.map((variant, index) => ({
            product_id: product.id, variant_id: variant.id, price: variant.price, qty: index + 1, subtotal: 1,
        })), 0, 10000);
        const items = await Order.getOrderItems(orderId);
        assert.equal(items.length, 2);
        assert.equal(items[0].variant_name, 'Merah / XL');
        assert.equal(items[0].variant_sku, 'K-M-XL');
        assert.equal(items[1].subtotal, 110000);
        assert.equal((await Order.getOrderById(orderId)).total_amount, 160000);
        const current = await Product.getById(product.id);
        assert.deepEqual(current.variants.map(v => v.stock), [4, 1]);
        assert.equal(current.stock, 5);
        product = current;
    });

    await t.test('missing, foreign and inactive variant IDs cannot bypass variant selection', async () => {
        await assert.rejects(Order.createOrder('Test', [{ product_id: product.id, price: product.price, qty: 1 }], 0, 0), /Pilih varian/);
        await assert.rejects(Order.createOrder('Test', [{ product_id: product.id, variant_id: 99999, price: 60000, qty: 1 }], 0, 0), /Pilih varian/);
    });

    await t.test('overselling duplicate cart lines rolls back all stock and order writes', async () => {
        const before = await db.get('SELECT COUNT(*) as total FROM orders');
        const item = { product_id: product.id, variant_id: product.variants[1].id, price: 55000, qty: 1 };
        await assert.rejects(Order.createOrder('Test', [item, item], 0, 0), /Stok/);
        assert.equal((await Product.getById(product.id)).stock, 5);
        assert.equal((await db.get('SELECT COUNT(*) as total FROM orders')).total, before.total);
    });

    await t.test('concurrent orders cannot spend the same stock twice', async () => {
        const item = { product_id: product.id, variant_id: product.variants[1].id, price: 55000, qty: 1 };
        const results = await Promise.allSettled([Order.createOrder('A', [item], 0, 0), Order.createOrder('B', [item], 0, 0)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal((await Product.getById(product.id)).variants[1].stock, 0);
        product = await Product.getById(product.id);
    });

    await t.test('invalid variant changes preserve the saved product', async () => {
        await assert.rejects(Product.update(product.id, { ...product, variants: [
            { name: 'XL', price: 1, stock: 1 }, { name: 'xl', price: 1, stock: 1 },
        ] }), /Nama varian/);
        await assert.rejects(Product.update(product.id, { ...product, variants: [{ name: 'XL', price: 1, stock: -1 }] }), /Stok/);
        await assert.rejects(Product.update(product.id, { ...product, variants: [{ name: 'XL', price: 1, stock: 1.5 }] }), /Stok/);
        await assert.rejects(Product.update(product.id, { ...product, variants: [
            { name: 'XL', sku: 'SAMA', price: 1, stock: 1 }, { name: 'L', sku: 'sama', price: 1, stock: 1 },
        ] }), /SKU/);
        assert.equal((await Product.getById(product.id)).variants.length, 2);
    });

    await t.test('renaming and removing a variant preserves historical order snapshots', async () => {
        const originalId = product.variants[0].id;
        await Product.update(product.id, { ...product, variants: [{ ...product.variants[0], name: 'Merah / XXL', sku: 'BARU' }] });
        const current = await Product.getById(product.id);
        assert.equal(current.variants[0].id, originalId);
        assert.equal(current.variants.length, 1);
        assert.equal(current.stock, 4);
        const items = await Order.getOrderItems(orderId);
        assert.equal(items[0].item_name, 'Kaos - Merah / XL');
        assert.equal(items[0].variant_sku, 'K-M-XL');
        assert.equal(items[1].variant_name, 'Biru / L');
        await assert.rejects(Order.createOrder('Test', [{ product_id: product.id, variant_id: product.variants[1].id, price: 55000, qty: 1 }], 0, 0), /Pilih varian/);
        product = current;
    });

    await t.test('stale prices and invalid discounts cannot change stock', async () => {
        const item = { product_id: product.id, variant_id: product.variants[0].id, price: 1, qty: 1 };
        await assert.rejects(Order.createOrder('Test', [item], 0, 0), /Harga/);
        await assert.rejects(Order.createOrder('Test', [{ ...item, price: 60000 }], 0, 70000), /Diskon/);
        assert.equal((await Product.getById(product.id)).stock, 4);
    });

    await t.test('checkout payment failure rolls back variant stock and order creation', async () => {
        const before = await db.get('SELECT COUNT(*) as total FROM orders');
        const item = { product_id: product.id, variant_id: product.variants[0].id, price: 60000, qty: 1 };
        await assert.rejects(Order.createOrder('Test', [item], 0, 0, 0, { amount: 60000, method: 'Cash', user_id: 99999 }), /Pengguna kasir/);
        assert.equal((await Product.getById(product.id)).stock, 4);
        assert.equal((await db.get('SELECT COUNT(*) as total FROM orders')).total, before.total);
    });

    await t.test('checkout commits variant stock, payment and finance together', async () => {
        const item = { product_id: product.id, variant_id: product.variants[0].id, price: 60000, qty: 1 };
        const id = await Order.createOrder('Test', [item], 0, 0, 0, { amount: 60000, method: 'Cash', user_id: 1 });
        assert.equal((await Product.getById(product.id)).stock, 3);
        const order = await Order.getOrderById(id);
        assert.equal(order.payment_status, 'Lunas');
        assert.equal(order.status, 'Selesai');
        assert.equal((await db.get('SELECT amount FROM payments WHERE order_id = ?', [id])).amount, 60000);
        assert.equal((await db.get('SELECT SUM(cash_revenue) as revenue FROM finance')).revenue, 60000);
    });

    await t.test('products without variants and older order items remain supported', async () => {
        const result = await Product.create({ name: 'Kertas', price: 1000, stock: 10 });
        const simple = await Product.getById(result.lastID);
        const id = await Order.createOrder('Test', [{ product_id: simple.id, price: 1000, qty: 2 }], 0, 0);
        const [item] = await Order.getOrderItems(id);
        assert.equal(item.variant_id, null);
        assert.equal(item.item_name, 'Kertas');
        assert.equal((await Product.getById(simple.id)).stock, 8);
        await Product.update(simple.id, { ...simple, stock: 8, variants: [{ name: 'A4', price: 1000, stock: 8 }] });
        assert.equal((await Order.getOrderItems(id))[0].item_name, 'Kertas');
    });

    await t.test('switching back to a simple product deactivates variants and keeps history', async () => {
        const oldVariantId = product.variants[0].id;
        await Product.update(product.id, { ...product, variants: [], price: 50000, stock: 2 });
        assert.equal((await Product.getById(product.id)).variants.length, 0);
        await assert.rejects(Order.createOrder('Test', [{ product_id: product.id, variant_id: oldVariantId, price: 60000, qty: 1 }], 0, 0), /tidak tersedia/);
        assert.equal((await Order.getOrderItems(orderId))[0].variant_name, 'Merah / XL');
        await assert.rejects(Product.deleteProduct(product.id), /FOREIGN KEY/);
        assert.ok(await Product.getById(product.id));
    });
});
