import { getDbConnection, withTransaction } from '../config/db.js';
const STORE_ID = 1;

async function getAll({ includeInactive = false } = {}) {
    const db = await getDbConnection();
    return db.all(`SELECT * FROM payment_methods WHERE store_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY id`, [STORE_ID]);
}

async function create(data) {
    const name = String(data?.name ?? '').trim();
    if (!name || name.length > 60) throw new Error('Nama metode bayar wajib diisi, maksimal 60 karakter.');
    return withTransaction(async db => {
        if (await db.get('SELECT id FROM payment_methods WHERE store_id = ? AND name = ? COLLATE NOCASE', [STORE_ID, name])) {
            throw new Error('Metode bayar sudah ada. Aktifkan kembali jika sedang nonaktif.');
        }
        return db.run("INSERT INTO payment_methods (store_id, name, kind) VALUES (?, ?, 'other')", [STORE_ID, name]);
    });
}

async function setActive(id, active) {
    if (typeof active !== 'boolean') throw new Error('Status metode bayar tidak valid.');
    return withTransaction(async db => {
        const result = await db.run('UPDATE payment_methods SET active = ? WHERE id = ? AND store_id = ?', [active ? 1 : 0, id, STORE_ID]);
        if (!result.changes) throw new Error('Metode bayar tidak ditemukan.');
        return result;
    });
}

async function requireActive(db, name) {
    const method = await db.get('SELECT * FROM payment_methods WHERE store_id = ? AND name = ? COLLATE NOCASE AND active = 1', [STORE_ID, String(name ?? '').trim()]);
    if (!method) throw new Error('Pilih metode bayar yang masih aktif.');
    return method;
}

export { getAll, create, setActive, requireActive };
