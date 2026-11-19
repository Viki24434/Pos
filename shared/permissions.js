export const PERMISSIONS = [
  { key: 'sales.view', label: 'Lihat pesanan dan cetak struk' },
  { key: 'sales.create', label: 'Buat pesanan' },
  { key: 'sales.pay', label: 'Terima pembayaran' },
  { key: 'sales.discount', label: 'Beri diskon' },
  { key: 'receivables.manage', label: 'Kelola piutang dan jatuh tempo' },
  { key: 'customers.manage', label: 'Kelola pelanggan' },
  { key: 'products.manage', label: 'Kelola produk, harga, dan stok' },
  { key: 'stock.manage', label: 'Barang masuk dan supplier' },
  { key: 'cost.view', label: 'Lihat dan ubah harga modal' },
  { key: 'finance.view', label: 'Lihat arus kas' },
  { key: 'finance.manage', label: 'Catat pemasukan dan pengeluaran' },
  { key: 'reports.view', label: 'Dashboard dan laporan laba' },
  { key: 'settings.manage', label: 'Pengaturan toko, printer, metode bayar' },
  { key: 'backup.manage', label: 'Backup dan pemulihan data' },
  { key: 'users.manage', label: 'Kelola akun dan hak akses', ownerOnly: true },
];
export const ROLES = ['Super Admin', 'Admin', 'Kasir'];
export function defaultPermissions(role) {
  if (role === 'Super Admin') return PERMISSIONS.map(item => item.key);
  if (role === 'Admin') return PERMISSIONS.filter(item => !item.ownerOnly && !['settings.manage', 'backup.manage'].includes(item.key)).map(item => item.key);
  if (role === 'Kasir') return ['sales.view', 'sales.create', 'sales.pay', 'receivables.manage'];
  return [];
}
export function effectivePermissions(user) {
  if (!user || (user.active != null && !Number(user.active))) return [];
  if (user.role === 'Super Admin') return defaultPermissions(user.role);
  let selected = user.permissions;
  if (typeof selected === 'string') { try { selected = JSON.parse(selected); } catch { return []; } }
  if (selected == null) selected = defaultPermissions(user.role);
  if (!Array.isArray(selected)) return [];
  return PERMISSIONS.filter(item => !item.ownerOnly && selected.includes(item.key)
    && (!['reports.view','stock.manage'].includes(item.key) || selected.includes('cost.view'))
    && (item.key !== 'finance.manage' || selected.includes('finance.view'))).map(item => item.key);
}
export function can(user, permission) { return effectivePermissions(user).includes(permission); }
export function homePath(user) {
  return [['reports.view', '/'], ['sales.create', '/orders/create'], ['sales.view', '/orders'], ['receivables.manage', '/receivables'], ['products.manage', '/products'], ['stock.manage', '/incoming-stock'], ['customers.manage', '/customers'], ['finance.view', '/finance'], ['settings.manage', '/settings'], ['backup.manage', '/settings'], ['users.manage', '/users']].find(([permission]) => can(user, permission))?.[1] || '/no-access';
}
