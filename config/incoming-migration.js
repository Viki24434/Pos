import { migrateExpiry } from './expiry-migration.js';
export async function migrateIncomingStock(db) {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL REFERENCES stores(id),
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS stock_receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL REFERENCES stores(id),
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            number TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL,
            supplier_name TEXT NOT NULL,
            reference TEXT NOT NULL DEFAULT '',
            receipt_date TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            update_cost INTEGER NOT NULL DEFAULT 1,
            total_amount REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(store_id, request_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_receipts_reference
            ON stock_receipts(store_id, supplier_id, reference COLLATE NOCASE) WHERE reference <> '';
        CREATE INDEX IF NOT EXISTS idx_stock_receipts_date ON stock_receipts(store_id, receipt_date);
        CREATE TABLE IF NOT EXISTS stock_receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id INTEGER NOT NULL REFERENCES stock_receipts(id),
            product_id INTEGER NOT NULL REFERENCES products(id),
            variant_id INTEGER REFERENCES product_variants(id),
            item_name TEXT NOT NULL,
            unit_name TEXT NOT NULL DEFAULT '',
            qty INTEGER NOT NULL CHECK(qty > 0),
            purchase_price REAL NOT NULL CHECK(purchase_price >= 0),
            subtotal REAL NOT NULL CHECK(subtotal >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_stock_receipt_items_receipt ON stock_receipt_items(receipt_id);
    `);
    await migrateExpiry(db);
}
