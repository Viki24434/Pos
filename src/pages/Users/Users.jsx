import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Table from '../../components/Table/Table';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Alert from '../../components/Alert/Alert';
import Modal from '../../components/Modal/Modal';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { PERMISSIONS, ROLES, defaultPermissions } from '../../../shared/permissions';
import './Users.css';

export default function Users() {
  const { user: currentUser, refresh } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    window.api.getUsers().then(rows => { if (active) setUsers(rows); }).catch(() => { if (active) setError('Gagal memuat pengguna.'); });
    return () => { active = false; };
  }, []);
  const open = (row = {}) => {
    setFormError('');
    setForm({ id: row.id, name: row.name || '', username: row.username || '', password: '', role: row.role || 'Kasir', active: row.active ?? 1, permissions: row.permissions || defaultPermissions('Kasir') });
  };
  const toggle = (key, checked) => {
    const selected = new Set(form.permissions);
    if (checked) {
      selected.add(key);
      if (['reports.view','stock.manage'].includes(key)) selected.add('cost.view');
      if (key === 'finance.manage') selected.add('finance.view');
    } else {
      selected.delete(key);
      if (key === 'cost.view') { selected.delete('reports.view'); selected.delete('stock.manage'); }
      if (key === 'finance.view') selected.delete('finance.manage');
    }
    setForm({ ...form, permissions: [...selected] });
  };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      if (!window.api.saveUser) throw new Error('Buka ulang aplikasi untuk memuat pengaturan hak akses.');
      const result = await window.api.saveUser(form);
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan akun.');
      setForm(null);
      setNotice('Akun dan hak akses tersimpan.');
      if (form.id === currentUser.id) { const updated = await refresh(); if (updated?.role === 'Super Admin') setUsers(await window.api.getUsers()); }
      else setUsers(await window.api.getUsers());
    } catch (failure) { setFormError(failure.message || 'Gagal menyimpan akun.'); }
    finally { setBusy(false); }
  };
  return <div className="users-page">
    <PageHeader title="Pengaturan User" subtitle="Akun, peran, dan hak akses" icon="fas fa-users-cog" actionLabel="Tambah Akun" actionIcon="fas fa-plus" onAction={() => open()} />
    <Alert>{error}</Alert><Alert variant="success">{notice}</Alert>
    <div className="card"><Input placeholder="Cari nama atau username..." value={search} onChange={event => setSearch(event.target.value)} />
      <Table columns={[
        { key: 'name', label: 'Nama', render: row => <strong>{row.name}{row.id === currentUser.id ? ' (Anda)' : ''}</strong> },
        { key: 'username', label: 'Username' },
        { key: 'role', label: 'Peran', render: row => <StatusBadge status={row.role} /> },
        { key: 'active', label: 'Status', render: row => row.active ? 'Aktif' : 'Nonaktif' },
        { key: 'permissions', label: 'Hak Akses', render: row => row.role === 'Super Admin' ? 'Akses penuh' : `${row.permissions.length} izin` },
      ]} data={users.filter(row => `${row.name} ${row.username}`.toLowerCase().includes(search.toLowerCase()))} renderActions={row => <Button variant="secondary" title="Edit Hak Akses" onClick={() => open(row)}>Edit</Button>} emptyText="Tidak ada pengguna." />
    </div>
    <Modal id="modal-user" isOpen={!!form} title={form?.id ? 'Edit Akun & Hak Akses' : 'Tambah Akun'} maxWidth={780} onClose={() => { if (!busy) setForm(null); }}>
      {form && <form onSubmit={save}>
        <Alert>{formError}</Alert>
        <div className="user-fields">
          <Input id="user-name" label="Nama Lengkap *" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Input id="user-username" label="Username *" autoComplete="off" required value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} />
          <Input id="user-password" label={form.id ? 'Password baru (Opsional)' : 'Password *'} type="password" autoComplete="new-password" minLength={6} required={!form.id} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
          <Select id="user-role" label="Peran" value={form.role} onChange={event => setForm({ ...form, role: event.target.value, permissions: defaultPermissions(event.target.value) })}>{ROLES.map(role => <option key={role}>{role}</option>)}</Select>
        </div>
        <label className="user-active"><input id="user-active" type="checkbox" checked={!!form.active} onChange={event => setForm({ ...form, active: event.target.checked ? 1 : 0 })} /> Akun aktif</label>
        <section className="user-permissions"><div className="user-permissions-heading"><strong>Hak Akses</strong><Button variant="secondary" disabled={busy || form.role === 'Super Admin'} onClick={() => setForm({ ...form, permissions: defaultPermissions(form.role) })}>Reset Sesuai Peran</Button></div>
          {form.role === 'Super Admin' ? <p>Super Admin memiliki akses penuh.</p> : <div className="user-permission-grid">{PERMISSIONS.filter(item => !item.ownerOnly).map(item => <label key={item.key}><input type="checkbox" data-permission={item.key} checked={form.permissions.includes(item.key)} onChange={event => toggle(item.key, event.target.checked)} />{item.label}</label>)}</div>}
        </section>
        <Button type="submit" variant="success" fullWidth disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Akun'}</Button>
      </form>}
    </Modal>
  </div>;
}
