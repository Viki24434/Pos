import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Alert from '../../components/Alert/Alert';
import Modal from '../../components/Modal/Modal';
import Table from '../../components/Table/Table';
import { useAuth } from '../../context/AuthContext';
import { formatRp } from '../../utils/format';
import './IncomingStock.css';

const EMPTY_FILTER = { start: '', end: '', search: '' };
const dateLabel = value => new Date(value + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const newItem = () => ({ key: crypto.randomUUID(), selection: '', qty: '1', purchase_price: '' });
async function fetchData(filter) {
  if (!window.api?.getStockReceipts) throw new Error('Buka ulang aplikasi untuk memuat barang masuk.');
  const [receipts, suppliers, products] = await Promise.all([window.api.getStockReceipts(filter), window.api.getSuppliers(), window.api.getProducts()]);
  return { receipts, suppliers, products };
}

export default function IncomingStock() {
  const { user } = useAuth();
  const [data, setData] = useState({ receipts: { rows: [], summary: { receipts: 0, amount: 0 } }, suppliers: [], products: [] });
  const [view, setView] = useState('receipts');
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [applied, setApplied] = useState(EMPTY_FILTER);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [form, setForm] = useState(null);
  const [supplier, setSupplier] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetchData(EMPTY_FILTER).then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(failure.message || 'Gagal memuat barang masuk.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const load = async nextFilter => {
    setLoading(true);
    setError('');
    try { setData(await fetchData(nextFilter)); }
    catch (failure) { setError(failure.message || 'Gagal memuat barang masuk.'); }
    finally { setLoading(false); }
  };
  const options = data.products.flatMap(product => product.variants?.length
    ? product.variants.map(variant => ({ key: `${product.id}:${variant.id}`, product_id: product.id, variant_id: variant.id, name: `${product.name} - ${variant.name}`, unit: product.unit_name || '', cost: variant.purchase_price ?? (product.cost_known ? product.purchase_price : '') }))
    : [{ key: `${product.id}:0`, product_id: product.id, variant_id: null, name: product.name, unit: product.unit_name || '', cost: product.cost_known ? product.purchase_price : '' }]);
  const updateItem = (key, fields) => setForm(previous => ({ ...previous, items: previous.items.map(row => row.key === key ? { ...row, ...fields } : row) }));
  const total = form?.items.reduce((sum, row) => sum + Math.round((Number(row.purchase_price) || 0) * 100) * (Number(row.qty) || 0), 0) / 100 || 0;
  const openSupplier = (row = {}) => { setModalError(''); setSupplier({ id: row.id, name: row.name || '', phone: row.phone || '', address: row.address || '', active: row.active ?? 1 }); };
  const openReceipt = () => {
    setModalError('');
    setForm({ supplier_id: '', receipt_date: today(), reference: '', notes: '', update_cost: true, request_id: crypto.randomUUID(), items: [newItem()] });
  };
  const saveSupplier = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setModalError('');
    try {
      const result = await window.api.saveSupplier(supplier);
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan supplier.');
      if (form && !supplier.id) setForm(previous => ({ ...previous, supplier_id: String(result.result) }));
      setSupplier(null);
      setNotice('Supplier tersimpan.');
      await load(applied);
    } catch (failure) { setModalError(failure.message); }
    finally { setBusy(false); }
  };
  const saveReceipt = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setModalError('');
    try {
      const items = form.items.map(row => {
        const option = options.find(item => item.key === row.selection);
        if (!option) throw new Error('Pilih produk atau varian pada setiap baris.');
        return { product_id: option.product_id, variant_id: option.variant_id, qty: Number(row.qty), purchase_price: row.purchase_price };
      });
      const result = await window.api.createStockReceipt({ ...form, user_id: user?.id, items });
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan barang masuk.');
      setForm(null);
      setNotice('Barang masuk tersimpan. Stok diperbarui.');
      await load(applied);
    } catch (failure) { setModalError(failure.message); }
    finally { setBusy(false); }
  };
  const openDetail = async row => {
    setError('');
    try { setDetail(await window.api.getStockReceiptDetail(row.id)); }
    catch (failure) { setError(failure.message || 'Gagal memuat rincian.'); }
  };

  return <div className="incoming-page">
    <PageHeader title="Barang Masuk & Supplier" icon="fas fa-truck-loading" subtitle="Penerimaan stok dan harga beli barang" actionLabel={view === 'receipts' ? 'Tambah Barang Masuk' : 'Tambah Supplier'} actionIcon="fas fa-plus" onAction={view === 'receipts' ? openReceipt : () => openSupplier()} />
    <Alert>{error}</Alert><Alert variant="success">{notice}</Alert>
    <div className="incoming-tabs" role="group" aria-label="Tampilan barang masuk">
      <Button variant={view === 'receipts' ? 'primary' : 'secondary'} onClick={() => { setView('receipts'); setNotice(''); }}>Barang Masuk</Button>
      <Button variant={view === 'suppliers' ? 'primary' : 'secondary'} onClick={() => { setView('suppliers'); setNotice(''); }}>Supplier</Button>
    </div>
    {view === 'receipts' ? <>
      <div className="incoming-summary"><div className="card"><span>Penerimaan</span><strong>{data.receipts.summary.receipts}</strong></div><div className="card"><span>Nilai Barang Masuk</span><strong>{formatRp(data.receipts.summary.amount)}</strong><small>Sesuai filter</small></div></div>
      <div className="card"><form className="incoming-filter" onSubmit={event => { event.preventDefault(); setApplied(filter); load(filter); }}>
        <Input id="incoming-start" aria-label="Dari tanggal" label="Dari Tanggal" type="date" value={filter.start} onChange={event => setFilter({ ...filter, start: event.target.value })} />
        <Input id="incoming-end" aria-label="Sampai tanggal" label="Sampai Tanggal" type="date" value={filter.end} onChange={event => setFilter({ ...filter, end: event.target.value })} />
        <Input id="incoming-search" aria-label="Cari barang masuk" label="Pencarian" placeholder="Supplier atau nomor nota" value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })} />
        <Button type="submit" disabled={loading} icon="fas fa-search">Cari</Button><Button variant="secondary" disabled={loading} onClick={() => { setFilter(EMPTY_FILTER); setApplied(EMPTY_FILTER); load(EMPTY_FILTER); }}>Reset</Button>
      </form></div>
      <div className="card incoming-history">{loading ? <p>Memuat barang masuk...</p> : <Table columns={[
        { key: 'receipt_date', label: 'Tanggal', render: row => dateLabel(row.receipt_date) },
        { key: 'number', label: 'No. Penerimaan', render: row => <div><strong>{row.number}</strong>{row.reference && <small>Nota: {row.reference}</small>}</div> },
        { key: 'supplier_name', label: 'Supplier' }, { key: 'item_count', label: 'Jenis Barang' },
        { key: 'total_amount', label: 'Nilai Barang', render: row => formatRp(row.total_amount) },
      ]} data={data.receipts.rows} emptyText="Belum ada barang masuk sesuai filter." renderActions={row => <Button variant="secondary" title="Detail Barang Masuk" onClick={() => openDetail(row)}>Detail</Button>} />}</div>
    </> : <div className="card incoming-suppliers">
      <Input aria-label="Cari supplier" placeholder="Cari nama atau telepon supplier" value={supplierSearch} onChange={event => setSupplierSearch(event.target.value)} />
      {loading ? <p>Memuat supplier...</p> : <Table columns={[{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Telepon' }, { key: 'address', label: 'Alamat' }, { key: 'active', label: 'Status', render: row => <span className={row.active ? 'incoming-active' : 'incoming-inactive'}>{row.active ? 'Aktif' : 'Nonaktif'}</span> }]} data={data.suppliers.filter(row => `${row.name} ${row.phone}`.toLowerCase().includes(supplierSearch.toLowerCase()))} emptyText="Belum ada supplier sesuai pencarian." renderActions={row => <Button variant="secondary" title="Edit Supplier" onClick={() => openSupplier(row)}>Edit</Button>} />}
    </div>}

    <Modal id="incoming-form" isOpen={!!form && !supplier} title="Catat Barang Masuk" maxWidth={900} onClose={() => { if (!busy) setForm(null); }}>
      {form && <form onSubmit={saveReceipt}>
        <Alert>{modalError}</Alert>
        <div className="incoming-form-top"><Select id="incoming-supplier" label="Supplier *" aria-label="Supplier barang masuk" required value={form.supplier_id} onChange={event => setForm({ ...form, supplier_id: event.target.value })}>
          <option value="">Pilih supplier</option>{data.suppliers.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name}{row.phone ? ` (${row.phone})` : ''}</option>)}
        </Select><Button variant="secondary" onClick={() => openSupplier()}>Tambah Supplier</Button></div>
        <div className="incoming-form-pair"><Input id="incoming-date" label="Tanggal Terima *" aria-label="Tanggal terima barang" type="date" required value={form.receipt_date} onChange={event => setForm({ ...form, receipt_date: event.target.value })} /><Input id="incoming-reference" label="Nomor Nota Supplier (Opsional)" value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></div>
        <section className="incoming-items">
          {form.items.map((row, index) => <div className="incoming-item" key={row.key}>
            <Select aria-label={`Barang masuk ${index+1}`} label={`Barang ${index+1} *`} required value={row.selection} onChange={event => { const option = options.find(item => item.key === event.target.value); updateItem(row.key, { selection: event.target.value, purchase_price: option?.cost ?? '' }); }}>
              <option value="">Pilih produk / varian</option>{options.map(option => <option key={option.key} value={option.key}>{option.name}{option.unit ? ` (${option.unit})` : ''}</option>)}
            </Select>
            <Input aria-label={`Jumlah barang ${index+1}`} label="Jumlah *" type="number" min="1" step="1" required value={row.qty} onChange={event => updateItem(row.key, { qty: event.target.value })} />
            <Input aria-label={`Harga beli barang ${index+1}`} label="Harga Beli / Satuan *" type="number" min="0" step="0.01" required value={row.purchase_price} onChange={event => updateItem(row.key, { purchase_price: event.target.value })} />
            <Button variant="danger" aria-label={`Hapus barang masuk ${index+1}`} disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter(item => item.key !== row.key) })}><i className="fas fa-trash" /></Button>
            <small>Subtotal: {formatRp(Math.round((Number(row.purchase_price) || 0) * 100) * (Number(row.qty) || 0) / 100)}</small>
          </div>)}
          <Button variant="secondary" icon="fas fa-plus" disabled={form.items.length >= 200} onClick={() => setForm({ ...form, items: [...form.items, newItem()] })}>Tambah Barang</Button>
        </section>
        <label className="incoming-cost-toggle"><input id="incoming-update-cost" type="checkbox" checked={form.update_cost} onChange={event => setForm({ ...form, update_cost: event.target.checked })} /> Perbarui harga modal dari harga beli ini</label>
        <details className="incoming-notes"><summary>Tambah catatan <span>Opsional</span></summary><textarea aria-label="Catatan barang masuk" className="input-field" rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></details>
        <div className="incoming-total"><span>Total Nilai Barang</span><strong>{formatRp(total)}</strong></div>
        <Button type="submit" variant="success" fullWidth disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Barang Masuk'}</Button>
      </form>}
    </Modal>
    <Modal id="incoming-supplier-modal" isOpen={!!supplier} title={supplier?.id ? 'Edit Supplier' : 'Tambah Supplier'} onClose={() => { if (!busy) { setSupplier(null); setModalError(''); } }}>
      {supplier && <form onSubmit={saveSupplier}><Alert>{modalError}</Alert>
        <Input id="supplier-name" label="Nama Supplier *" required value={supplier.name} onChange={event => setSupplier({ ...supplier, name: event.target.value })} />
        <Input id="supplier-phone" label="Telepon" type="tel" value={supplier.phone} onChange={event => setSupplier({ ...supplier, phone: event.target.value })} />
        <Input id="supplier-address" label="Alamat" value={supplier.address} onChange={event => setSupplier({ ...supplier, address: event.target.value })} />
        <label className="incoming-cost-toggle"><input type="checkbox" checked={!!supplier.active} onChange={event => setSupplier({ ...supplier, active: event.target.checked ? 1 : 0 })} /> Supplier aktif</label>
        <Button type="submit" fullWidth disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Supplier'}</Button>
      </form>}
    </Modal>
    <Modal id="incoming-detail" isOpen={!!detail} title="Detail Barang Masuk" maxWidth={850} onClose={() => setDetail(null)}>
      {detail && <><div className="incoming-detail-info"><div><strong>{detail.supplier_name}</strong><small>{detail.number}</small></div><div>{dateLabel(detail.receipt_date)}{detail.reference && <small>Nota: {detail.reference}</small>}</div></div>
        <Table columns={[{ key: 'item_name', label: 'Barang' }, { key: 'qty', label: 'Jumlah', render: row => `${row.qty}${row.unit_name ? ` ${row.unit_name}` : ''}` }, { key: 'purchase_price', label: 'Harga Beli', render: row => formatRp(row.purchase_price) }, { key: 'subtotal', label: 'Subtotal', render: row => formatRp(row.subtotal) }]} data={detail.items} />
        <div className="incoming-total"><span>Total Nilai Barang</span><strong>{formatRp(detail.total_amount)}</strong></div>
        {detail.notes && <p className="incoming-detail-notes">{detail.notes}</p>}<small>Dicatat oleh {detail.user_name || 'Pengguna'}{detail.update_cost ? ' · Harga modal diperbarui' : ''}</small>
      </>}
    </Modal>
  </div>;
}
