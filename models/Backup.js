import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { withDatabaseWork } from '../config/db.js';
import { migrateProductVariants, migrateCustomerStatus } from '../config/db.js';
import { migratePayments } from '../config/payment-migration.js';
import { migratePrintSettings } from '../config/print-migration.js';
import { migrateVipPrices } from '../config/vip-migration.js';
import { migrateCosts } from '../config/cost-migration.js';
import { migrateOrderNotes } from '../config/order-notes-migration.js';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

async function validateDatabase(db) {
    const check = await db.get('PRAGMA quick_check');
    if (Object.values(check)[0] !== 'ok') throw new Error('File backup rusak atau tidak dapat dibaca.');
    for (const table of ['stores', 'users', 'products', 'customers', 'orders', 'order_items', 'payments', 'categories', 'units', 'finance', 'income', 'expenditure']) {
        const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (!row) throw new Error('File tersebut bukan backup database aplikasi ini.');
    }
    if (!await db.get('SELECT id FROM stores WHERE id=1')) throw new Error('Data toko tidak ditemukan dalam backup.');
    if (!await db.get('SELECT id FROM users WHERE store_id=1 LIMIT 1')) throw new Error('Backup tidak memiliki akun pengguna untuk login.');
}

export async function inspectBackup(filename) {
    const db = await open({ filename, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try { await validateDatabase(db); }
    finally { await db.close(); }
}

function copyIntoDatabase(db, filename) {
    return new Promise((resolve, reject) => {
        const backup = db.getDatabaseInstance().backup(filename, 'main', 'main', false, error => {
            if (error) { reject(error); return; }
            backup.retryErrors = [];
            backup.step(-1, stepError => {
                backup.finish(finishError => {
                    if (stepError || finishError) reject(stepError || finishError);
                    else resolve();
                });
            });
        });
    });
}

export async function restoreBackup(filename, safetyDirectory, hooks = {}) {
    return withDatabaseWork(async db => {
        const activeFile = (await db.all('PRAGMA database_list')).find(database => database.name === 'main')?.file;
        if (activeFile && await canonicalPath(filename) === await canonicalPath(activeFile)) throw new Error('Pilih file backup, bukan database yang sedang digunakan.');
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-restore-'));
        const stagedFile = path.join(temporaryDirectory, 'restore.sqlite');
        let safetyPath;
        try {
            const source = await open({ filename, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
            try {
                await validateDatabase(source);
                await source.exec(`VACUUM INTO '${stagedFile.replaceAll("'", "''")}'`);
            } finally { await source.close(); }
            const staged = await open({ filename: stagedFile, driver: sqlite3.Database });
            try {
                await staged.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
                await migrateProductVariants(staged);
                await migrateCustomerStatus(staged);
                await migrateVipPrices(staged);
                await migrateCosts(staged);
                await migrateOrderNotes(staged);
                await migratePayments(staged);
                await migratePrintSettings(staged);
                await staged.exec('COMMIT');
                await validateDatabase(staged);
                if ((await staged.all('PRAGMA foreign_key_check')).length) throw new Error('Relasi data dalam backup tidak valid.');
            } finally { await staged.close(); }
            await fs.mkdir(safetyDirectory, { recursive: true });
            safetyPath = path.join(safetyDirectory, `sebelum-pemulihan-${randomUUID()}.sqlite`);
            await db.exec(`VACUUM INTO '${safetyPath.replaceAll("'", "''")}'`);
            try {
                await hooks.beforeRestore?.(safetyPath);
                await copyIntoDatabase(db, stagedFile);
            }
            catch (error) {
                try { await copyIntoDatabase(db, safetyPath); }
                finally { await hooks.rollbackRestore?.(); }
                throw error;
            }
            return { safetyPath };
        } finally {
            await fs.unlink(stagedFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
            await fs.rmdir(temporaryDirectory);
        }
    });
}

async function canonicalPath(file) {
    try { return (await fs.realpath(file)).toLowerCase(); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return path.resolve(file).toLowerCase();
    }
}

export async function createBackup(destination) {
    const target = path.resolve(destination);
    return withDatabaseWork(async db => {
        const databases = await db.all('PRAGMA database_list');
        const source = databases.find(database => database.name === 'main')?.file;
        if (source) {
            const targetPath = await canonicalPath(target);
            const sourcePath = await canonicalPath(source);
            if ([sourcePath, sourcePath + '-wal', sourcePath + '-shm', sourcePath + '-journal'].includes(targetPath)) {
                throw new Error('Pilih nama file berbeda dari database aplikasi yang sedang digunakan.');
            }
        }
        const temporaryDirectory = await fs.mkdtemp(path.join(path.dirname(target), '.app-js-backup-'));
        const temporaryFile = path.join(temporaryDirectory, 'database.sqlite');
        try {
            await db.exec(`VACUUM INTO '${temporaryFile.replaceAll("'", "''")}'`);
            const copy = await open({ filename: temporaryFile, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
            try {
                const check = await copy.get('PRAGMA quick_check');
                if (Object.values(check)[0] !== 'ok') throw new Error('Pemeriksaan file backup gagal.');
            } finally { await copy.close(); }
            const { size } = await fs.stat(temporaryFile);
            await fs.rename(temporaryFile, target);
            return { path: target, size };
        } finally {
            await fs.unlink(temporaryFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
            await fs.rmdir(temporaryDirectory);
        }
    });
}
