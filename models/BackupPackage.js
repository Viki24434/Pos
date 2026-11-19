import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import unzipper from 'unzipper';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createBackup, inspectBackup, restoreBackup } from './Backup.js';

const safeImageName = name => typeof name === 'string' && name.length > 0 && !/[\\/:\0]/.test(name) && !['.', '..'].includes(name);
async function cleanup(directory) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('app-js-package-')) throw new Error('Direktori sementara tidak valid.');
    await fs.rm(directory, { recursive: true, force: true });
}
async function imageNames(database) {
    const db = await open({ filename: database, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    try {
        const rows = await db.all("SELECT DISTINCT img FROM products WHERE img IS NOT NULL AND img != '' AND img != 'default.png'");
        return rows.map(row => row.img);
    } finally { await db.close(); }
}
async function pack(database, imageDirectory, destination) {
    const included = [];
    const missing = [];
    for (const name of await imageNames(database)) {
        if (!safeImageName(name)) throw new Error('Nama gambar dalam database tidak valid.');
        try {
            const stat = await fs.lstat(path.join(imageDirectory, name));
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Berkas gambar tidak valid.');
            included.push(name);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            missing.push(name);
        }
    }
    await new Promise((resolve, reject) => {
        const output = createWriteStream(destination, { flags: 'wx' });
        const archive = archiver('zip', { zlib: { level: 6 } });
        let failure;
        const fail = error => {
            failure ||= error;
            archive.abort();
            output.destroy();
        };
        output.on('close', () => failure ? reject(failure) : resolve());
        output.on('error', fail);
        archive.on('error', fail);
        archive.on('warning', fail);
        archive.pipe(output);
        archive.file(database, { name: 'database.sqlite' });
        for (const name of included) archive.file(path.join(imageDirectory, name), { name: `images/${name}` });
        archive.append(JSON.stringify({ format: 'APP-js-backup', version: 1, imageCount: included.length, missingImages: missing }), { name: 'manifest.json' });
        archive.finalize().catch(fail);
    });
    return { imageCount: included.length, missingImages: missing.length };
}
async function unpack(filename, directory) {
    const archive = await unzipper.Open.file(filename);
    const seen = new Set();
    await fs.mkdir(path.join(directory, 'images'));
    for (const entry of archive.files) {
        if (entry.type === 'Directory' && entry.path === 'images/') continue;
        const valid = entry.type === 'File' && (['database.sqlite', 'manifest.json'].includes(entry.path) || (entry.path.startsWith('images/') && safeImageName(entry.path.slice(7))));
        if (!valid || seen.has(entry.path)) throw new Error('Isi paket backup tidak valid.');
        seen.add(entry.path);
        await pipeline(entry.stream(), createWriteStream(path.join(directory, ...entry.path.split('/')), { flags: 'wx' }));
    }
    if (!seen.has('database.sqlite') || !seen.has('manifest.json')) throw new Error('Database atau informasi backup tidak ditemukan.');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.format !== 'APP-js-backup' || manifest.version !== 1) throw new Error('Format backup tidak didukung.');
    const files = await fs.readdir(path.join(directory, 'images'));
    if (files.length !== manifest.imageCount) throw new Error('Jumlah gambar dalam backup tidak sesuai.');
    await inspectBackup(path.join(directory, 'database.sqlite'));
    for (const name of await imageNames(path.join(directory, 'database.sqlite'))) {
        if (!safeImageName(name)) throw new Error('Nama gambar dalam database backup tidak valid.');
        if (!files.includes(name) && !manifest.missingImages?.includes(name)) throw new Error('Gambar yang dirujuk database tidak ditemukan dalam backup.');
    }
    return { database: path.join(directory, 'database.sqlite'), images: path.join(directory, 'images'), files };
}
export async function createBackupPackage(destination, imageDirectory) {
    const target = path.resolve(destination);
    if (path.extname(target).toLowerCase() !== '.zip') throw new Error('Simpan backup lengkap menggunakan ekstensi .zip.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-package-'));
    const stagedArchive = path.join(path.dirname(target), `.app-js-${randomUUID()}.zip`);
    try {
        const database = path.join(directory, 'database.sqlite');
        await createBackup(database);
        const info = await pack(database, imageDirectory, stagedArchive);
        await fs.rename(stagedArchive, target);
        return { path: target, size: (await fs.stat(target)).size, ...info };
    } finally {
        await fs.unlink(stagedArchive).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await cleanup(directory);
    }
}
export async function inspectBackupPackage(filename) {
    if (path.extname(filename).toLowerCase() !== '.zip') return inspectBackup(filename);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-package-'));
    try { await unpack(filename, directory); }
    finally { await cleanup(directory); }
}
export async function restoreBackupPackage(filename, safetyDirectory, imageDirectory) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-package-'));
    const replaced = [];
    let safetyArchive;
    try {
        const bundle = path.extname(filename).toLowerCase() === '.zip' ? await unpack(filename, directory) : { database: filename, files: [] };
        const rollbackDirectory = path.join(directory, 'rollback');
        await fs.mkdir(rollbackDirectory);
        await fs.mkdir(imageDirectory, { recursive: true });
        const result = await restoreBackup(bundle.database, safetyDirectory, {
            beforeRestore: async safetyDatabase => {
                safetyArchive = safetyDatabase.replace(/\.sqlite$/, '.zip');
                await pack(safetyDatabase, imageDirectory, safetyArchive);
                for (const name of bundle.files) {
                    const destination = path.join(imageDirectory, name);
                    let existed = false;
                    try {
                        const stat = await fs.lstat(destination);
                        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Lokasi gambar pemulihan tidak valid.');
                        await fs.copyFile(destination, path.join(rollbackDirectory, name));
                        existed = true;
                    } catch (error) { if (error.code !== 'ENOENT') throw error; }
                    replaced.push({ name, existed });
                    await fs.copyFile(path.join(bundle.images, name), destination);
                }
            },
            rollbackRestore: async () => {
                for (const image of replaced.reverse()) {
                    const destination = path.join(imageDirectory, image.name);
                    if (image.existed) await fs.copyFile(path.join(rollbackDirectory, image.name), destination);
                    else await fs.unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
                }
            },
        });
        return { ...result, safetyPath: safetyArchive, imageCount: bundle.files.length };
    } finally { await cleanup(directory); }
}
