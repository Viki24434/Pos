import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Card from '../../components/Card/Card';
import Table from '../../components/Table/Table';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Alert from '../../components/Alert/Alert';
import Modal from '../../components/Modal/Modal';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import RowActions from '../../components/RowActions/RowActions';

const EMPTY_CUSTOMER = { id: '', name: '', phone: '', address: '', status: 'Member' };

async function fetchCustomers() {
  const rows = await window.api.getCustomers();
  if (!Array.isArray(rows)) throw new Error('Format data pelanggan tidak valid.');
  return rows;
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_CUSTOMER);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    let active = true;
    fetchCustomers().then(rows => {
      if (active) setCustomers(rows);
    }).catch(() => {
      if (active) setError('Gagal memuat data pelanggan.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const loadData = async () => setCustomers(await fetchCustomers());
  const closeModal = () => { if (!saving) setIsModalOpen(false); };
  const changeField = (field, value) => setForm(previous => ({ ...previous, [field]: value }));

  const handleOpenModal = (customer = null) => {
    setForm(customer ? {
      id: customer.id,
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
      status: customer.status || (Number(customer.is_member) === 1 ? 'Member' : 'Umum'),
    } : EMPTY_CUSTOMER);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSave = async event => {
    event.preventDefault();
    if (saving) return;
    const payload = { name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim(), status: form.status };
    if (!payload.name) {
      setFormError('Nama pelanggan wajib diisi.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const result = form.id ? await window.api.updateCustomer(form.id, payload) : await window.api.createCustomer(payload);
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan data pelanggan.');
      setIsModalOpen(false);
      setError('');
      try { await loadData(); }
      catch { setError('Pelanggan sudah disimpan, tetapi daftar gagal dimuat ulang. Silakan muat ulang halaman.'); }
    } catch (saveError) {
      setFormError(saveError.message || 'Gagal menyimpan data pelanggan.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async id => {
    if (deleting !== null || !confirm('Yakin ingin menghapus pelanggan ini?')) return;
    setDeleting(id);
    try {
      const result = await window.api.deleteCustomer(id);
      if (!result?.success) throw new Error(result?.message || 'Gagal menghapus pelanggan.');
      setError('');
      try { await loadData(); }
      catch { setError('Pelanggan sudah dihapus, tetapi daftar gagal dimuat ulang. Silakan muat ulang halaman.'); }
    } catch (deleteError) {
      setError(deleteError.message || 'Gagal menghapus pelanggan.');
    } finally {
      setDeleting(null);
    }
  };

  const query = search.trim().toLowerCase();
  const filteredCustomers = customers.filter(customer =>
    String(customer.name || '').toLowerCase().includes(query) || String(customer.phone || '').toLowerCase().includes(query)
  );
  const columns = [
    { key: 'name', label: 'Nama Pelanggan', render: row => <b>{row.name}</b> },
    { key: 'phone', label: 'No. Telepon', render: row => row.phone || '-' },
    { key: 'address', label: 'Alamat', render: row => row.address || '-' },
    { key: 'status', label: 'Status', headerStyle: { textAlign: 'center' }, cellStyle: { textAlign: 'center' }, render: row => <StatusBadge status={row.status || (Number(row.is_member) === 1 ? 'Member' : 'Umum')} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Alert>{error}</Alert>
      <PageHeader title="Data Langganan" icon="fas fa-users" actionLabel="Tambah Pelanggan" actionIcon="fas fa-plus" onAction={() => handleOpenModal()} />
      <Card>
        <Input placeholder="Cari nama atau no. telepon..." value={search} onChange={event => setSearch(event.target.value)} />
        <Table columns={columns} data={filteredCustomers} emptyText={loading ? 'Memuat data pelanggan...' : 'Tidak ada data pelanggan.'}
          renderActions={row => <RowActions onEdit={() => handleOpenModal(row)} onDelete={() => handleDelete(row.id)} />} />
      </Card>
      <Modal id="modal-customer" isOpen={isModalOpen} title={form.id ? 'Edit Pelanggan' : 'Tambah Pelanggan'} icon="fas fa-user" onClose={closeModal}>
        <Alert>{formError}</Alert>
        <form onSubmit={handleSave}>
          <Input id="customer-name" label="Nama Pelanggan *" required value={form.name} onChange={event => changeField('name', event.target.value)} />
          <Input id="customer-phone" type="tel" label="No. Telepon / WhatsApp" value={form.phone} onChange={event => changeField('phone', event.target.value)} />
          <div className="input-group">
            <label htmlFor="customer-address">Alamat Lengkap</label>
            <textarea id="customer-address" className="input-field" rows="3" value={form.address} onChange={event => changeField('address', event.target.value)} style={{ resize: 'vertical' }} />
          </div>
          <Select id="customer-status" label="Status Member" value={form.status} onChange={event => changeField('status', event.target.value)}>
            <option value="Member">Member</option><option value="VIP">VIP</option><option value="Umum">Umum</option>
          </Select>
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <Button type="submit" variant="success" fullWidth disabled={saving} style={{ justifyContent: 'center' }}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
            <Button variant="secondary" disabled={saving} onClick={closeModal}>Batal</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
