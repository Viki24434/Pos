export async function migrateUserAccess(db) {
    const columns = await db.all('PRAGMA table_info(users)');
    if (!columns.some(column => column.name === 'active')) await db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    if (!columns.some(column => column.name === 'permissions')) await db.exec('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL');
    if (!columns.some(column => column.name === 'permissions') && !await db.get("SELECT id FROM users WHERE store_id=1 AND role='Super Admin' AND active=1")) {
        await db.run("UPDATE users SET role='Super Admin' WHERE id=(SELECT id FROM users WHERE store_id=1 AND role='Admin' AND active=1 ORDER BY id LIMIT 1)");
    }
}
