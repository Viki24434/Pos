export async function ensureBatchTables(db) {
    await db.exec(`CREATE TABLE IF NOT EXISTS inventory_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL DEFAULT 1,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
        receipt_item_id INTEGER,
        batch_code TEXT NOT NULL DEFAULT '',
        expires_on TEXT,
        received_qty INTEGER NOT NULL CHECK(received_qty >= 0),
        remaining_qty INTEGER NOT NULL CHECK(remaining_qty >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_batches_sku ON inventory_batches(product_id,variant_id,expires_on);
    CREATE TABLE IF NOT EXISTS order_item_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_item_id INTEGER NOT NULL REFERENCES order_items(id),
        batch_id INTEGER NOT NULL REFERENCES inventory_batches(id),
        qty INTEGER NOT NULL CHECK(qty > 0)
    );
    CREATE TABLE IF NOT EXISTS batch_removals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES inventory_batches(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        qty INTEGER NOT NULL CHECK(qty > 0),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
}

export async function migrateExpiry(db) {
    await ensureBatchTables(db);
    const columns = await db.all('PRAGMA table_info(stock_receipt_items)');
    if (columns.length) {
        if (!columns.some(column => column.name === 'batch_code')) await db.exec("ALTER TABLE stock_receipt_items ADD COLUMN batch_code TEXT NOT NULL DEFAULT ''");
        if (!columns.some(column => column.name === 'expires_on')) await db.exec('ALTER TABLE stock_receipt_items ADD COLUMN expires_on TEXT');
    }
    // Existing quantities have no reliable expiry date; retain them as undated stock.
    await db.exec(`INSERT INTO inventory_batches (product_id,variant_id,received_qty,remaining_qty)
        SELECT p.id,NULL,p.stock,p.stock FROM products p WHERE p.store_id=1 AND p.stock>0
        AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1)
        AND NOT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.product_id=p.id AND b.variant_id IS NULL);
        INSERT INTO inventory_batches (product_id,variant_id,received_qty,remaining_qty)
        SELECT p.id,v.id,v.stock,v.stock FROM product_variants v JOIN products p ON p.id=v.product_id
        WHERE p.store_id=1 AND v.active=1 AND v.stock>0
        AND NOT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.product_id=p.id AND b.variant_id=v.id);`);
}
