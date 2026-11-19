import bcrypt from 'bcrypt';
import { withTransaction, withDatabaseWork } from '../config/db.js';
import { ROLES, PERMISSIONS, effectivePermissions } from '../shared/permissions.js';

export function publicUser(user) {
    return { id: user.id, name: user.name, username: user.username, role: user.role, active: user.active, permissions: effectivePermissions(user) };
}
export async function getSessionUser(id) {
    return withDatabaseWork(async db => {
        const user = await db.get('SELECT * FROM users WHERE id=? AND store_id=1 AND active=1', [id]);
        return user ? publicUser(user) : null;
    });
}
export async function authenticate(credentials) {
    return withTransaction(async db => {
        const user = await db.get('SELECT * FROM users WHERE username=? COLLATE NOCASE AND store_id=1 AND active=1', [String(credentials?.username || '').trim()]);
        if (!user || typeof credentials.password !== 'string') return null;
        const hash = String(user.password).replace(/^\$2y\$/, '$2a$');
        const hashed = /^\$2[ab]\$/.test(hash);
        const matches = hashed ? await bcrypt.compare(credentials.password, hash) : credentials.password === user.password;
        if (!matches) return null;
        if (!hashed) await db.run('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(credentials.password, 10), user.id]);
        return publicUser(user);
    });
}
export async function getUsers() {
    return withDatabaseWork(async db => (await db.all('SELECT id,name,username,role,active,permissions FROM users WHERE store_id=1 ORDER BY id')).map(user => ({ ...publicUser(user), permissions: effectivePermissions({ ...user, active: 1 }) })));
}
export async function saveUser(data) {
    const name = String(data.name || '').trim();
    const username = String(data.username || '').trim();
    if (!name || !username) throw new Error('Nama dan username wajib diisi.');
    if (!ROLES.includes(data.role)) throw new Error('Peran tidak valid.');
    const active = Number(data.active ?? 1);
    if (![0, 1].includes(active)) throw new Error('Status akun tidak valid.');
    const selected = data.permissions;
    if (selected != null && (!Array.isArray(selected) || selected.some(key => !PERMISSIONS.some(item => item.key === key && (!item.ownerOnly || data.role === 'Super Admin'))))) throw new Error('Hak akses tidak valid.');
    const id = data.id == null ? null : Number(data.id);
    if (data.id != null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Akun tidak valid.');
    if ((!id || data.password) && (typeof data.password !== 'string' || data.password.length < 6)) throw new Error('Password minimal 6 karakter.');
    const password = data.password ? await bcrypt.hash(data.password, 10) : null;
    return withTransaction(async db => {
        const existing = id ? await db.get('SELECT * FROM users WHERE id=? AND store_id=1', [id]) : null;
        if (id && !existing) throw new Error('Akun tidak ditemukan.');
        if (await db.get('SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?', [username,id || 0])) throw new Error('Username sudah digunakan.');
        if (existing?.role === 'Super Admin' && existing.active && (data.role !== 'Super Admin' || !active)) {
            const count = await db.get("SELECT COUNT(*) as total FROM users WHERE store_id=1 AND role='Super Admin' AND active=1");
            if (count.total <= 1) throw new Error('Minimal satu Super Admin harus tetap aktif.');
        }
        const permissions = data.role === 'Super Admin' || selected == null ? null : JSON.stringify([...new Set(selected)]);
        if (id) {
            await db.run('UPDATE users SET name=?,username=?,role=?,active=?,permissions=?,password=COALESCE(?,password) WHERE id=? AND store_id=1', [name,username,data.role,active,permissions,password,id]);
            return id;
        }
        return (await db.run('INSERT INTO users (store_id,name,username,password,role,active,permissions) VALUES (1,?,?,?,?,?,?)', [name,username,password,data.role,active,permissions])).lastID;
    });
}
