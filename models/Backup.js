import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { withDatabaseWork } from '../config/db.js';

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
