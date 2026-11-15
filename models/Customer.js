import { getDbConnection, withTransaction } from '../config/db.js';
const STORE_ID = 1;
const CUSTOMER_STATUSES = ['Member', 'VIP', 'Umum'];

function customerFields(data) {
    const name = String(data?.name ?? '').trim();
    if (!name) throw new Error('Nama pelanggan wajib diisi.');
    const status = data.status ?? (Number(data.is_member) === 1 ? 'Member' : 'Umum');
    if (!CUSTOMER_STATUSES.includes(status)) throw new Error('Status pelanggan tidak valid.');
    return [name, String(data.phone ?? '').trim(), String(data.address ?? '').trim(), status === 'Umum' ? 0 : 1, status];
}

function customerId(id) {
    const value = Number(id);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('ID pelanggan tidak valid.');
    return value;
}

async function getCustomers() {
    const db = await getDbConnection();
    return db.all('SELECT * FROM customers WHERE store_id = ? ORDER BY name COLLATE NOCASE ASC, id ASC', [STORE_ID]);
}

async function addCustomer(data) {
    const fields = customerFields(data);
    return withTransaction(db => db.run(
        'INSERT INTO customers (store_id, name, phone, address, is_member, status) VALUES (?, ?, ?, ?, ?, ?)',
        [STORE_ID, ...fields]
    ));
}

async function updateCustomer(id, data) {
    const fields = customerFields(data);
    const selectedId = customerId(id);
    return withTransaction(async db => {
        const result = await db.run(
            'UPDATE customers SET name=?, phone=?, address=?, is_member=?, status=? WHERE id=? AND store_id=?',
            [...fields, selectedId, STORE_ID]
        );
        if (!result.changes) throw new Error('Pelanggan tidak ditemukan.');
        return result;
    });
}

async function deleteCustomer(id) {
    const selectedId = customerId(id);
    return withTransaction(async db => {
        const result = await db.run('DELETE FROM customers WHERE id=? AND store_id=?', [selectedId, STORE_ID]);
        if (!result.changes) throw new Error('Pelanggan tidak ditemukan.');
        return result;
    });
}

export { getCustomers, addCustomer, updateCustomer, deleteCustomer };
