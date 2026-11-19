export async function migrateCosts(db) {
    const products = await db.all('PRAGMA table_info(products)');
    if (!products.some(column => column.name === 'cost_known')) {
        await db.exec('ALTER TABLE products ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 0');
        await db.run('UPDATE products SET cost_known = 1 WHERE purchase_price > 0');
    }
    for (const table of ['product_variants', 'order_items']) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some(column => column.name === 'purchase_price')) {
            await db.exec(`ALTER TABLE ${table} ADD COLUMN purchase_price REAL DEFAULT NULL CHECK(purchase_price IS NULL OR purchase_price >= 0)`);
        }
    }
}
