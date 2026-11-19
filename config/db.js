import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'node:process';
import { migratePayments } from './payment-migration.js';
import { migratePrintSettings } from './print-migration.js';
import { migrateVipPrices } from './vip-migration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;
let transactionQueue = Promise.resolve();

async function withDatabaseWork(work) {
    const pending = transactionQueue.then(async () => {
        const db = await getDbConnection();
        return work(db);
    });
    transactionQueue = pending.catch(() => {});
    return pending;
}

async function withTransaction(work) {
    return withDatabaseWork(async db => {
        await db.exec('BEGIN IMMEDIATE');
        try {
            const result = await work(db);
            await db.exec('COMMIT');
            return result;
        } catch (error) {
            await db.exec('ROLLBACK');
            throw error;
        }
    });
}

async function migrateProductVariants(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sku TEXT,
        price REAL NOT NULL CHECK(price >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
        active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);`);
    const columns = await db.all('PRAGMA table_info(order_items)');
    for (const [name, definition] of [
        ['variant_id', 'INTEGER REFERENCES product_variants(id)'],
        ['variant_name', 'TEXT'],
        ['variant_sku', 'TEXT'],
    ]) {
        if (!columns.some(column => column.name === name)) {
            await db.exec(`ALTER TABLE order_items ADD COLUMN ${name} ${definition}`);
        }
    }
}

async function getDbConnection() {
    if (!dbInstance) {
        dbInstance = open({
            filename: process.env.APP_JS_DB_PATH || path.join(__dirname, '..', 'db_percetakan.sqlite'),
            driver: sqlite3.verbose().Database
        }).then(async db => {
            await db.run('PRAGMA foreign_keys = ON');
            return db;
        }).catch(error => {
            dbInstance = null;
            throw error;
        });
    }
    return dbInstance;
}

async function migrateCustomerStatus(db) {
    const columns = await db.all('PRAGMA table_info(customers)');
    if (columns.length && !columns.some(column => column.name === 'status')) {
        await db.exec("ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'Umum' CHECK(status IN ('Umum', 'Member', 'VIP'))");
        await db.run("UPDATE customers SET status = CASE WHEN is_member = 1 THEN 'Member' ELSE 'Umum' END");
    }
}

async function inisialisasiDatabase() {
    try {
        const db = await getDbConnection();

        const userTable = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`);

        if (!userTable) {
            console.log('Menyiapkan struktur awal tabel dari database.sql...');
            
            const sqlFilePath = path.join(__dirname, '..', 'database.sql');
            
            if (fs.existsSync(sqlFilePath)) {
                try {
                    const sqlFileContent = fs.readFileSync(sqlFilePath, 'utf8');
                    await db.exec(sqlFileContent);
                    console.log('Berhasil mengimpor struktur dan data dari database.sql!');
                } catch (err) {
                    console.error('Gagal eksekusi database.sql:', err.message);
                }
            } else {
                console.error('Peringatan: File database.sql tidak ditemukan di direktori utama.');
            }
        } else {
            console.log('Struktur database sudah ada, melewati proses impor.');
        }
        
        try {
            const columns = await db.all(`PRAGMA table_info(products)`);
            if (columns.length > 0) {
                const hasImgColumn = columns.some(col => col.name === 'img');
                if (!hasImgColumn) {
                    console.log('Menambahkan kolom img ke tabel products...');
                    await db.run(`ALTER TABLE products ADD COLUMN img TEXT DEFAULT 'default.png'`);
                    console.log('Kolom img berhasil ditambahkan.');
                }
            }
        } catch (e) {
            console.error('Peringatan: Gagal mengecek/menambah kolom img:', e.message);
        }

        try {
            await db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                name TEXT, 
                username TEXT, 
                password TEXT, 
                role TEXT
            )`);
            
            const cekUser = await db.get("SELECT COUNT(*) as total FROM users");
            if (cekUser.total === 0) {
                await db.run("INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)", ['Administrator', 'admin', 'admin', 'Super Admin']);
            }
        } catch (e) {
            console.error('Gagal membuat atau mengecek user admin:', e.message);
        }

        await migrateProductVariants(db);
        await withTransaction(migrateVipPrices);
        await migrateCustomerStatus(db);
        await withTransaction(migratePayments);
        await withTransaction(migratePrintSettings);
        console.log('Database SQLite siap digunakan.');
    } catch (error) {
        console.error('Gagal inisialisasi database SQLite:', error.message);
    }
}

export {
    getDbConnection,
    inisialisasiDatabase,
    migrateProductVariants,
    migrateCustomerStatus,
    withTransaction,
    withDatabaseWork
};
