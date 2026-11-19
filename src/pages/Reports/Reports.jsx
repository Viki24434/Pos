import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Alert from '../../components/Alert/Alert';
import Table from '../../components/Table/Table';
import Modal from '../../components/Modal/Modal';
import { formatRp } from '../../utils/format';
import './Reports.css';

function defaultDates() {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { start: today.slice(0, 8) + '01', end: today };
}
const showMoney = value => value == null ? 'Belum lengkap' : formatRp(value);
async function fetchReport(filter) {
  if (!window.api?.getSalesProfitReport) throw new Error('Tutup dan buka ulang aplikasi untuk memuat laporan penjualan dan laba.');
  return window.api.getSalesProfitReport(filter);
}
export default function Reports() {
  const [filter, setFilter] = useState(defaultDates);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [costForm, setCostForm] = useState(null);
  const [costError, setCostError] = useState('');
  const [savingCost, setSavingCost] = useState(false);
  const openCosts = async order => {
    setCostError('');
    try {
      const items = await window.api.getOrderDetail(order.id);
      const missing = items.filter(item => item.purchase_price == null);
      if (!missing.length) {
        setReport(await fetchReport(filter));
        return;
      }
      setCostForm({ orderId: order.id, invoice: order.invoice_number, items: missing.map(item => ({ ...item, purchase_price: '' })) });
    } catch { setError('Gagal memuat harga modal pesanan.'); }
  };
  const saveCosts = async event => {
    event.preventDefault();
    if (savingCost) return;
    setSavingCost(true); setCostError('');
    try {
      if (!window.api?.saveOrderCosts) throw new Error('Buka ulang aplikasi untuk mengisi modal.');
      const result = await window.api.saveOrderCosts(costForm.orderId, costForm.items.map(item => ({ id: item.id, purchase_price: item.purchase_price })));
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan modal.');
      setCostForm(null);
      try { setReport(await fetchReport(filter)); }
      catch { setError('Modal tersimpan. Muat ulang laporan.'); }
    } catch (saveError) { setCostError(saveError.message); }
    finally { setSavingCost(false); }
  };
  useEffect(() => {
    let active = true;
    fetchReport(defaultDates()).then(result => { if (active) setReport(result); })
      .catch(loadError => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const load = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { setReport(await fetchReport(filter)); }
    catch (loadError) { setReport(null); setError(loadError.message); }
    finally { setBusy(false); }
  };
  const summary = report?.summary;
  const columns = [
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'created_at', label: 'Tanggal', render: row => new Date(row.created_at + (row.created_at.includes('Z') ? '' : 'Z')).toLocaleDateString('id-ID') },
    { key: 'customer_name', label: 'Pelanggan' },
    { key: 'net_sales', label: 'Penjualan Bersih', render: row => formatRp(row.net_sales) },
    { key: 'recorded_cost', label: 'Modal', render: row => row.missing_cost_items ? <Button variant="primary" icon="fas fa-pen" className="report-cost-button" onClick={() => openCosts(row)}>Isi Harga Modal</Button> : formatRp(row.recorded_cost) },
    { key: 'gross_profit', label: 'Laba Kotor', render: row => showMoney(row.gross_profit) },
    { key: 'remaining', label: 'Piutang', render: row => formatRp(row.remaining) },
  ];
  return (
    <div className="reports-page">
      <PageHeader title="Laporan Penjualan dan Laba" icon="fas fa-chart-line" />
      <form className="card reports-filter" onSubmit={load}>
        <Input label="Dari Tanggal" type="date" required value={filter.start} onChange={event => setFilter({ ...filter, start: event.target.value })} />
        <Input label="Sampai Tanggal" type="date" required min={filter.start} value={filter.end} onChange={event => setFilter({ ...filter, end: event.target.value })} />
        <Button type="submit" disabled={busy}>{busy ? 'Memuat...' : 'Tampilkan Laporan'}</Button>
      </form>
      <Alert>{error}</Alert>
      {summary && <>
        {!!summary.missing_orders && <div className="reports-missing-cost"><span>{summary.missing_orders} pesanan belum diisi modal.</span><Button variant="primary" icon="fas fa-pen" className="report-cost-button" onClick={() => openCosts(report.rows.find(row => row.missing_cost_items))}>Isi Harga Modal</Button></div>}
        <div className="reports-summary">
          <div className="card"><h3>Penjualan Bersih</h3><strong>{formatRp(summary.net_sales)}</strong><p>{summary.order_count} pesanan · setelah diskon, di luar pajak</p></div>
          <div className="card"><h3>Modal Tercatat</h3><strong>{formatRp(summary.recorded_cost)}</strong><p>Modal per satuan saat pesanan dibuat</p></div>
          <div className="card"><h3>Laba Kotor</h3><strong>{showMoney(summary.gross_profit)}</strong><p>Penjualan bersih dikurangi modal</p></div>
          <div className="card"><h3>Laba Bersih</h3><strong>{showMoney(summary.net_profit)}</strong><p>Laba kotor + pemasukan lain − pengeluaran</p></div>
        </div>
        <dl className="card reports-totals">
          {[
            ['Terbayar', summary.total_paid], ['Piutang', summary.receivables],
            ['Pemasukan Lain', summary.other_income], ['Pengeluaran', summary.expenses],
            ['Diskon', summary.discount], ['Pajak', summary.tax],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatRp(value)}</dd></div>)}
        </dl>
        <div className="card"><h3>Rincian Penjualan</h3><Table columns={columns} data={report.rows} emptyText="Belum ada penjualan pada periode ini." /></div>
      </>}
      <Modal id="report-cost-modal" isOpen={!!costForm} onClose={() => { if (!savingCost) setCostForm(null); }} title={`Isi Harga Modal — ${costForm?.invoice || ''}`} maxWidth={600}>
        <Alert>{costError}</Alert>
        <form onSubmit={saveCosts}>
          <p>Isi modal per satuan sesuai transaksi.</p>
          {costForm?.items.map(item => <Input key={item.id} label={`${item.item_name || item.product_name} (${item.qty} unit)`} type="number" min="0" step="0.01" required disabled={savingCost} value={item.purchase_price} onChange={event => setCostForm(previous => ({ ...previous, items: previous.items.map(row => row.id === item.id ? { ...row, purchase_price: event.target.value } : row) }))} />)}
          <Button type="submit" variant="success" fullWidth disabled={savingCost}>{savingCost ? 'Menyimpan...' : 'Simpan Modal'}</Button>
        </form>
      </Modal>
    </div>
  );
}
