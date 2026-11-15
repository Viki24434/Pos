import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';

process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection, withTransaction } = await import('../config/db.js');
const { migratePayments } = await import('../config/payment-migration.js');
const Order = await import('../models/Order.js');
const Product = await import('../models/Product.js');
const PaymentMethod = await import('../models/PaymentMethod.js');
const Finance = await import('../models/Finance.js');

test('payments, custom methods and existing database upgrade', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    let schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    schema = schema.replace('  payment_method TEXT NOT NULL,', "  payment_method TEXT CHECK(payment_method IN ('Cash','Transfer','QRIS')) NOT NULL,")
        .replace(/ {2}other_revenue[^\n]*\n/, '')
        .replace(/CREATE TABLE IF NOT EXISTS payment_methods \([\s\S]*?INSERT OR IGNORE INTO payment_methods[^;]*;/, '');
    await db.exec(schema);
    await db.run("INSERT INTO users (id, store_id, username, password, role) VALUES (7, 1, 'kasir-test', 'test', 'Kasir')");
    await db.run("INSERT INTO orders (id, store_id, user_id, customer_id, customer_name, invoice_number, total_amount) VALUES (50, 1, 7, 0, 'Legacy', 'OLD', 100000)");
    await db.run("INSERT INTO payments (id, store_id, order_id, user_id, payment_method, amount, created_at) VALUES (80, 1, 50, 7, 'Transfer', 25000, '2026-01-02 09:00:00')");
    await db.run("UPDATE sqlite_sequence SET seq = 100 WHERE name = 'payments'");
    await db.run('DELETE FROM users WHERE id = 1');

    await t.test('migration retains previous payments, indexes, foreign keys and numbering', async () => {
        await withTransaction(migratePayments);
        await withTransaction(migratePayments);
        const old = await db.get('SELECT * FROM payments WHERE id = 80');
        assert.equal(old.amount, 25000);
        assert.equal(old.created_at, '2026-01-02 09:00:00');
        assert.equal((await db.get("SELECT seq FROM sqlite_sequence WHERE name = 'payments'")).seq, 100);
        assert.equal((await db.all('PRAGMA foreign_key_check')).length, 0);
        assert.ok((await db.all('PRAGMA index_list(payments)')).some(index => index.name === 'idx_payments_order_id'));
        assert.equal((await PaymentMethod.getAll()).length, 3);
    });

    let dana;
    await t.test('custom methods can be created, deactivated and reactivated without deleting history', async () => {
        const result = await PaymentMethod.create({ name: '  DANA  ' });
        dana = (await PaymentMethod.getAll()).find(method => method.id === result.lastID);
        assert.equal(dana.name, 'DANA');
        await assert.rejects(PaymentMethod.create({ name: 'dana' }), /sudah ada/);
        await assert.rejects(PaymentMethod.create({ name: '  ' }), /wajib diisi/);
        await PaymentMethod.setActive(dana.id, false);
        assert.ok(!(await PaymentMethod.getAll()).some(method => method.id === dana.id));
        assert.ok((await PaymentMethod.getAll({ includeInactive: true })).some(method => method.id === dana.id));
        await PaymentMethod.setActive(dana.id, true);
    });

    const created = await Product.create({ name: 'Pembayaran Test', price: 100000, stock: 20 });
    const item = { product_id: created.lastID, price: 100000, qty: 1 };
    let orderId;
    await t.test('checkout uses the current cashier and accepts a custom method for a deposit', async () => {
        orderId = await Order.createOrder('DP Test', [item], 0, 0, 0, { amount: 30000, method: 'dana', user_id: 7 });
        const order = await Order.getOrderById(orderId);
        assert.equal(order.user_id, 7);
        assert.equal(order.payment_status, 'DP');
        const payment = await db.get('SELECT * FROM payments WHERE order_id = ?', [orderId]);
        assert.equal(payment.payment_method, 'DANA');
        assert.equal(payment.user_id, 7);
        assert.ok(payment.id > 100);
    });

    await t.test('invalid or excessive payments cannot change paid totals', async () => {
        for (const amount of [0, -10, NaN, 70001, 1.001]) {
            await assert.rejects(Order.addPayment(orderId, 7, 'DANA', amount));
        }
        await assert.rejects(Order.addPayment(orderId, 1, 'DANA', 100), /Pengguna kasir/);
        await PaymentMethod.setActive(dana.id, false);
        await assert.rejects(Order.addPayment(orderId, 7, 'DANA', 100), /masih aktif/);
        await PaymentMethod.setActive(dana.id, true);
        assert.equal((await db.get('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [orderId])).total, 30000);
    });

    await t.test('finance failure rolls back the payment and order status together', async () => {
        await db.exec("CREATE TRIGGER reject_test_finance BEFORE INSERT ON finance BEGIN SELECT RAISE(ABORT, 'Test finance failure'); END;");
        await assert.rejects(Order.addPayment(orderId, 7, 'DANA', 70000), /Test finance failure/);
        await db.exec('DROP TRIGGER reject_test_finance');
        assert.equal((await Order.getOrderById(orderId)).payment_status, 'DP');
        assert.equal((await db.get('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [orderId])).total, 30000);
    });

    await t.test('remaining balance is checked in the database and simultaneous settlement cannot double charge', async () => {
        const results = await Promise.allSettled([Order.addPayment(orderId, 7, 'DANA', 70000), Order.addPayment(orderId, 7, 'Cash', 70000)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        const order = await Order.getOrderById(orderId);
        assert.equal(order.payment_status, 'Lunas');
        assert.equal(order.status, 'Selesai');
        assert.equal((await db.get('SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [orderId])).total, 100000);
        assert.equal((await Order.getAllOrders({ search: 'DP Test' }))[0].total_paid, 100000);
    });

    await t.test('unpaid checkout can be paid partially and settled using different methods', async () => {
        const id = await Order.createOrder('Bayar Nanti', [item], 0, 0, 0, { amount: 0, method: '', user_id: 7 });
        assert.equal((await Order.getOrderById(id)).payment_status, 'Belum Bayar');
        assert.equal((await Order.addPayment(id, 7, 'Transfer', 40000)).remaining, 60000);
        assert.equal((await Order.getOrderById(id)).payment_status, 'DP');
        await Order.addPayment(id, 7, 'QRIS', 60000);
        assert.equal((await Order.getOrderById(id)).payment_status, 'Lunas');
    });

    await t.test('custom payments are included in finance balances and method totals', async () => {
        await PaymentMethod.setActive(dana.id, false);
        const summary = await Finance.getSummary('', '');
        assert.equal(summary.saldoOther, 100000);
        assert.equal(summary.methods.find(method => method.name === 'DANA').total, 100000);
        assert.ok(summary.rekap.some(row => row.other_in === 100000));
        assert.equal(summary.totalPiutang, 75000);
        await PaymentMethod.setActive(dana.id, true);
    });
});
