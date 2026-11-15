// Run in the initialization transaction; old payment IDs and timestamps are retained.
async function migratePayments(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS payment_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL DEFAULT 1,
        name TEXT COLLATE NOCASE NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('cash','transfer','qris','other')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        UNIQUE(store_id, name)
    );
    INSERT OR IGNORE INTO payment_methods (store_id, name, kind)
        VALUES (1, 'Cash', 'cash'), (1, 'Transfer', 'transfer'), (1, 'QRIS', 'qris');`);
    const table = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'");
    if (table && /CHECK\s*\(\s*payment_method\s+IN/i.test(table.sql)) {
        const sequence = await db.get("SELECT seq FROM sqlite_sequence WHERE name='payments'");
        await db.exec(`CREATE TABLE payments_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            payment_method TEXT NOT NULL,
            amount DECIMAL(15,2) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            store_id INTEGER NOT NULL
        );
        INSERT INTO payments_new (id, order_id, user_id, payment_method, amount, created_at, store_id)
            SELECT id, order_id, user_id, payment_method, amount, created_at, store_id FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_new RENAME TO payments;
        CREATE INDEX idx_payments_order_id ON payments(order_id);
        CREATE INDEX idx_payments_user_id ON payments(user_id);`);
        if (sequence) await db.run("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name='payments'", [sequence.seq]);
    }
    await db.run(`INSERT OR IGNORE INTO payment_methods (store_id, name, kind)
        SELECT DISTINCT store_id, payment_method, CASE payment_method
            WHEN 'Cash' THEN 'cash' WHEN 'Transfer' THEN 'transfer' WHEN 'QRIS' THEN 'qris' ELSE 'other' END FROM payments`);
    const columns = await db.all('PRAGMA table_info(finance)');
    if (!columns.some(column => column.name === 'other_revenue')) {
        await db.exec('ALTER TABLE finance ADD COLUMN other_revenue DECIMAL(15,2) DEFAULT 0.00');
    }
}

export { migratePayments };
