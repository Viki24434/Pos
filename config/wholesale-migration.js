export async function migrateWholesalePrices(db) {
    for (const table of ['products', 'product_variants']) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some(column => column.name === 'wholesale_prices')) {
            await db.exec(`ALTER TABLE ${table} ADD COLUMN wholesale_prices TEXT NOT NULL DEFAULT '[]'`);
        }
    }
}
