import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Alert from '../../components/Alert/Alert';
import Table from '../../components/Table/Table';
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
    { key: 'recorded_cost', label: 'Modal', render: row => row.missing_cost_items ? 'Belum lengkap' : formatRp(row.recorded_cost) },
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
        {!!summary.missing_orders && <Alert>{summary.missing_orders} pesanan belum memiliki modal lengkap. Isi harga modal produk untuk transaksi berikutnya. Laba transaksi lama yang belum mencatat modal ditandai belum lengkap.</Alert>}
        <div className="reports-summary">
          <div className="card"><h3>Penjualan Bersih</h3><strong>{formatRp(summary.net_sales)}</strong><p>{summary.order_count} pesanan · setelah diskon, di luar pajak</p></div>
          <div className="card"><h3>Modal Tercatat</h3><strong>{formatRp(summary.recorded_cost)}</strong><p>Modal per satuan saat pesanan dibuat</p></div>
          <div className="card"><h3>Laba Kotor</h3><strong>{showMoney(summary.gross_profit)}</strong><p>Penjualan bersih dikurangi modal</p></div>
          <div className="card"><h3>Laba Bersih</h3><strong>{showMoney(summary.net_profit)}</strong><p>Laba kotor + pemasukan lain − pengeluaran</p></div>
        </div>
        <div className="card reports-totals">
          <span>Terbayar <b>{formatRp(summary.total_paid)}</b></span><span>Piutang <b>{formatRp(summary.receivables)}</b></span>
          <span>Pemasukan Lain <b>{formatRp(summary.other_income)}</b></span><span>Pengeluaran <b>{formatRp(summary.expenses)}</b></span>
          <span>Diskon <b>{formatRp(summary.discount)}</b></span><span>Pajak <b>{formatRp(summary.tax)}</b></span>
        </div>
        <div className="card"><h3>Rincian Penjualan</h3><Table columns={columns} data={report.rows} emptyText="Belum ada penjualan pada periode ini." /></div>
      </>}
    </div>
  );
}
