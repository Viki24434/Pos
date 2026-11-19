export async function migrateBarcodeSettings(db){
    const columns=await db.all('PRAGMA table_info(stores)');
    if(!columns.some(column=>column.name==='barcode_settings'))await db.exec("ALTER TABLE stores ADD COLUMN barcode_settings TEXT NOT NULL DEFAULT '{}'");
}
