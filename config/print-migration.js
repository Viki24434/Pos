export async function migratePrintSettings(db) {
    const columns = await db.all('PRAGMA table_info(stores)');
    for (const [name, definition] of [
        ['receipt_paper', "TEXT NOT NULL DEFAULT '80mm'"],
        ['printer_name', "TEXT NOT NULL DEFAULT ''"],
        ['print_direct', 'INTEGER NOT NULL DEFAULT 0'],
        ['footer', "TEXT NOT NULL DEFAULT ''"],
    ]) {
        if (!columns.some(column => column.name === name)) await db.exec(`ALTER TABLE stores ADD COLUMN ${name} ${definition}`);
    }
}
