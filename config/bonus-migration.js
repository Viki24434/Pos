export async function migrateBonusPromotions(db) {
    for (const table of ['products', 'product_variants']) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        for (const name of ['buy_qty', 'free_qty']) {
            if (!columns.some(column => column.name === name)) {
                await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
            }
        }
    }
    const columns = await db.all('PRAGMA table_info(order_items)');
    if (!columns.some(column => column.name === 'is_free')) {
        await db.exec('ALTER TABLE order_items ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0');
    }
}
