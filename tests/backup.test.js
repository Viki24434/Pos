import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-js-backup-test-'));
process.env.APP_JS_DB_PATH = path.join(directory, 'active.sqlite');
const { getDbConnection, withTransaction } = await import('../config/db.js');
const { createBackup } = await import('../models/Backup.js');

test('backup includes committed WAL data and safely handles replacement and active database paths', async t => {
    const db = await getDbConnection();
    t.after(async () => {
        await db.close();
        for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
        await fs.rmdir(directory);
    });
    await db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT);');
    const target = path.join(directory, "backup's copy.sqlite");
    await Promise.all([
        withTransaction(connection => connection.run('INSERT INTO records VALUES (1, ?)', ['Pelanggan VIP'])),
        createBackup(target),
        withTransaction(connection => connection.run("INSERT INTO records VALUES (2, 'Pembayaran')")),
    ]);
    let copy = await open({ filename: target, driver: sqlite3.Database });
    assert.equal((await copy.get('SELECT COUNT(*) as count FROM records')).count, 1);
    assert.equal((await copy.get('PRAGMA quick_check')).quick_check, 'ok');
    await copy.close();
    await createBackup(target);
    copy = await open({ filename: target, driver: sqlite3.Database });
    assert.equal((await copy.get('SELECT COUNT(*) as count FROM records')).count, 2);
    await copy.close();
    await assert.rejects(createBackup(process.env.APP_JS_DB_PATH), /nama file berbeda/);
    await assert.rejects(createBackup(process.env.APP_JS_DB_PATH + '-wal'), /nama file berbeda/);
    await assert.rejects(createBackup(path.join(directory, 'missing', 'copy.sqlite')));
    assert.equal((await db.get('SELECT COUNT(*) as count FROM records')).count, 2);
    assert.equal((await fs.readdir(directory)).some(name => name.startsWith('.app-js-backup-')), false);
});
