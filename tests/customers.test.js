import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';

process.env.APP_JS_DB_PATH = ':memory:';
const { getDbConnection, migrateCustomerStatus } = await import('../config/db.js');
const Customer = await import('../models/Customer.js');

test('customer data and legacy membership migration', async t => {
    const db = await getDbConnection();
    t.after(() => db.close());
    const schema = await fs.readFile(new URL('../database.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace(/ {2}status TEXT NOT NULL DEFAULT 'Umum'[^\n]*\n/, ''));
    await db.run("INSERT INTO customers (store_id, name, is_member) VALUES (1, 'Anggota lama', 1), (1, 'Umum lama', 0)");

    await t.test('existing membership survives migration and repeated startup', async () => {
        await migrateCustomerStatus(db);
        const rows = await Customer.getCustomers();
        assert.ok(Array.isArray(rows));
        assert.equal(rows[0].status, 'Member');
        assert.equal(rows[1].status, 'Umum');
        await Customer.updateCustomer(rows[0].id, { ...rows[0], status: 'VIP' });
        await migrateCustomerStatus(db);
        assert.equal((await Customer.getCustomers())[0].status, 'VIP');
    });

    let id;
    await t.test('create trims fields and stores VIP with membership enabled', async () => {
        const result = await Customer.addCustomer({ name: '  Budi  ', phone: ' 0812345 ', address: ' Jalan Baru ', status: 'VIP' });
        id = result.lastID;
        const customer = (await Customer.getCustomers()).find(row => row.id === id);
        assert.equal(customer.name, 'Budi');
        assert.equal(customer.phone, '0812345');
        assert.equal(customer.address, 'Jalan Baru');
        assert.equal(customer.status, 'VIP');
        assert.equal(customer.is_member, 1);
    });

    await t.test('updates keep all three statuses in sync with membership', async () => {
        for (const status of ['Umum', 'Member', 'VIP']) {
            await Customer.updateCustomer(id, { name: 'Budi', phone: '08', address: '', status });
            const customer = (await Customer.getCustomers()).find(row => row.id === id);
            assert.equal(customer.status, status);
            assert.equal(customer.is_member, status === 'Umum' ? 0 : 1);
        }
    });

    await t.test('invalid names, statuses and IDs fail without changing data', async () => {
        await assert.rejects(Customer.addCustomer({ name: '   ', status: 'Member' }), /Nama pelanggan/);
        await assert.rejects(Customer.updateCustomer(id, { name: 'Budi', status: 'Tidak dikenal' }), /Status pelanggan/);
        await assert.rejects(Customer.updateCustomer(99999, { name: 'Budi', status: 'Member' }), /tidak ditemukan/);
        await assert.rejects(Customer.deleteCustomer('invalid'), /ID pelanggan/);
        assert.equal((await Customer.getCustomers()).find(row => row.id === id).status, 'VIP');
    });

    await t.test('another store customer is not listed, updated or deleted', async () => {
        const other = await db.run("INSERT INTO customers (store_id, name) VALUES (2, 'Toko lain')");
        assert.equal((await Customer.getCustomers()).some(row => row.id === other.lastID), false);
        await assert.rejects(Customer.updateCustomer(other.lastID, { name: 'Berubah', status: 'Umum' }), /tidak ditemukan/);
        await assert.rejects(Customer.deleteCustomer(other.lastID), /tidak ditemukan/);
        assert.equal((await db.get('SELECT name FROM customers WHERE id = ?', [other.lastID])).name, 'Toko lain');
    });

    await t.test('delete returns a result and removes only the selected customer', async () => {
        const before = (await Customer.getCustomers()).length;
        assert.equal((await Customer.deleteCustomer(id)).changes, 1);
        assert.equal((await Customer.getCustomers()).length, before - 1);
        await assert.rejects(Customer.deleteCustomer(id), /tidak ditemukan/);
    });
});
