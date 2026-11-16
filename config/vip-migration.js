export async function migrateVipPrices(db) {
    for (const table of ['products', 'product_variants']) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some(column => column.name === 'vip_price')) {
            await db.exec(`ALTER TABLE ${table} ADD COLUMN vip_price REAL DEFAULT NULL CHECK(vip_price IS NULL OR vip_price >= 0)`);
        }
    }
}
