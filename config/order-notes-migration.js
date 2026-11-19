export async function migrateOrderNotes(db) {
    const columns = await db.all('PRAGMA table_info(orders)');
    if (!columns.some(column => column.name === 'notes')) {
        await db.exec("ALTER TABLE orders ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
    }
}
