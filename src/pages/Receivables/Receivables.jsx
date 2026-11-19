import { useEffect, useState } from 'react';
import Alert from '../../components/Alert/Alert';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Modal from '../../components/Modal/Modal';
import Table from '../../components/Table/Table';
import PageHeader from '../../components/PageHeader/PageHeader';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import PaymentForm from '../../components/PaymentForm/PaymentForm';
import { useAuth } from '../../context/AuthContext';
import { formatRp } from '../../utils/format';
import './Receivables.css';

const EMPTY_FILTER = { search: '', status: 'all', due: 'all' };
const EMPTY_DATA = { rows: [], summary: { remaining: 0, invoices: 0, overdue: 0, overdue_amount: 0 } };
const dateLabel = value => value ? new Date(value.slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Belum diatur';

async function fetchReceivables(filter) {
  if (!window.api?.getReceivables) throw new Error('Buka ulang aplikasi untuk memuat daftar piutang.');
  return window.api.getReceivables(filter);
}

export default function Receivables() {
  const { user, can } = useAuth();
  const [data, setData] = useState(EMPTY_DATA);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [appliedFilter, setAppliedFilter] = useState(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [payment, setPayment] = useState(null);
  const [detail, setDetail] = useState(null);
  const [due, setDue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    let active = true;
    fetchReceivables(EMPTY_FILTER).then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(failure.message || 'Gagal memuat piutang.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const load = async nextFilter => {
    setLoading(true);
    setError('');
    try { setData(await fetchReceivables(nextFilter)); }
    catch (failure) { setError(failure.message || 'Gagal memuat piutang.'); }
    finally { setLoading(false); }
  };
  const search = event => {
    event.preventDefault();
    setAppliedFilter(filter);
    setNotice('');
    load(filter);
  };
  const openDetail = async row => {
    setError('');
    try {
      const [items, payments] = await Promise.all([window.api.getOrderDetail(row.id), window.api.getOrderPayments(row.id)]);
      setDetail({ ...row, items, payments });
    } catch { setError('Gagal memuat riwayat piutang.'); }
  };
  const submitPayment = async ({ amount, method, payments }) => {
    if (busy) return;
    setBusy(true);
    setModalError('');
    try {
      const result = await window.api.processPayment({ id: payment.id, total: amount, paymentMethod: method, payments, userId: user?.id });
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan pembayaran.');
      setPayment(null);
      setNotice('Pembayaran tersimpan.');
      await load(appliedFilter);
    } catch (failure) { setModalError(failure.message || 'Gagal menyimpan pembayaran.'); }
    finally { setBusy(false); }
  };
  const saveDueDate = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setModalError('');
    try {
      const result = await window.api.setReceivableDueDate(due.id, due.value);
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan jatuh tempo.');
      setDue(null);
      setNotice('Jatuh tempo tersimpan.');
      await load(appliedFilter);
    } catch (failure) { setModalError(failure.message || 'Gagal menyimpan jatuh tempo.'); }
    finally { setBusy(false); }
  };

  const columns = [
    { key: 'invoice_number', label: 'Invoice', render: row => <div><strong className="receivable-invoice">{row.invoice_number}</strong><small>{dateLabel(row.created_at)}</small></div> },
    { key: 'customer_name', label: 'Pelanggan', render: row => <div><strong>{row.customer_name}</strong>{row.customer_phone && <small>{row.customer_phone}</small>}</div> },
    { key: 'total_amount', label: 'Tagihan', render: row => formatRp(row.total_amount) },
    { key: 'total_paid', label: 'Terbayar', render: row => formatRp(row.total_paid) },
    { key: 'remaining', label: 'Sisa Piutang', render: row => <strong>{formatRp(row.remaining)}</strong> },
    { key: 'due_date', label: 'Jatuh Tempo', render: row => <div className={row.overdue ? 'receivable-overdue' : ''}>{dateLabel(row.due_date)}{row.overdue === 1 && <small>Lewat jatuh tempo</small>}</div> },
    { key: 'debt_status', label: 'Status', render: row => <StatusBadge status={row.debt_status} /> },
  ];

  return <div className="receivables-page">
    <PageHeader title="Daftar Piutang" icon="fas fa-file-invoice-dollar" subtitle="Tagihan pelanggan yang belum lunas" />
    <Alert>{error}</Alert>
    <Alert variant="success">{notice}</Alert>
    <div className="receivable-summary" aria-busy={loading}>
      <div className="card"><span>Total Piutang</span><strong>{formatRp(data.summary.remaining)}</strong><small>Sesuai filter yang ditampilkan</small></div>
      <div className="card"><span>Invoice Belum Lunas</span><strong>{data.summary.invoices}</strong><small>Termasuk pembayaran sebagian</small></div>
      <div className="card"><span>Lewat Jatuh Tempo</span><strong>{formatRp(data.summary.overdue_amount)}</strong><small>{data.summary.overdue} invoice</small></div>
    </div>
    <div className="card">
      <form className="receivable-filter" onSubmit={search}>
        <Input id="receivable-search" aria-label="Cari piutang" label="Pencarian" placeholder="Invoice, pelanggan, atau telepon" value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })} />
        <Select id="receivable-status" aria-label="Status piutang" label="Pembayaran" value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value })}>
          <option value="all">Semua piutang</option><option value="unpaid">Belum bayar</option><option value="partial">Sudah cicil / DP</option>
        </Select>
        <Select id="receivable-due" aria-label="Filter jatuh tempo" label="Jatuh Tempo" value={filter.due} onChange={event => setFilter({ ...filter, due: event.target.value })}>
          <option value="all">Semua</option><option value="overdue">Lewat jatuh tempo</option><option value="undated">Belum diatur</option>
        </Select>
        <Button type="submit" variant="primary" icon="fas fa-search" disabled={loading}>Cari</Button>
        <Button variant="secondary" disabled={loading} onClick={() => { setFilter(EMPTY_FILTER); setAppliedFilter(EMPTY_FILTER); setNotice(''); load(EMPTY_FILTER); }}>Reset</Button>
      </form>
    </div>
    <div className="card receivable-table" aria-busy={loading}>
      {loading ? <p className="receivable-loading">Memuat piutang...</p> : <Table columns={columns} data={data.rows} emptyText="Tidak ada piutang sesuai filter." renderActions={row => <div className="receivable-actions">
        {can('sales.pay') && <Button variant="success" icon="fas fa-wallet" title="Bayar Piutang" onClick={() => { setModalError(''); setPayment(row); }}>Bayar</Button>}
        <div><Button variant="secondary" title="Riwayat Piutang" aria-label={`Riwayat ${row.invoice_number}`} onClick={() => openDetail(row)}><i className="fas fa-history" /></Button>
        <Button variant="secondary" title="Atur Jatuh Tempo" aria-label={`Jatuh tempo ${row.invoice_number}`} onClick={() => { setModalError(''); setDue({ ...row, value: row.due_date || '' }); }}><i className="fas fa-calendar-alt" /></Button></div>
      </div>} />}
    </div>
    <Modal id="receivable-payment" isOpen={!!payment} title="Bayar Piutang" onClose={() => { if (!busy) setPayment(null); }}>
      <p>{payment?.customer_name}<small className="receivable-modal-invoice">{payment?.invoice_number}</small></p>
      {payment && <PaymentForm total={payment.remaining} busy={busy} error={modalError} onSubmit={submitPayment} />}
    </Modal>
    <Modal id="receivable-due-modal" isOpen={!!due} title="Atur Jatuh Tempo" onClose={() => { if (!busy) setDue(null); }}>
      <form onSubmit={saveDueDate}>
        <p>{due?.customer_name}<small className="receivable-modal-invoice">{due?.invoice_number}</small></p>
        <Alert>{modalError}</Alert>
        <Input id="receivable-due-date" aria-label="Tanggal jatuh tempo" label="Jatuh Tempo (Opsional)" type="date" value={due?.value || ''} onChange={event => setDue({ ...due, value: event.target.value })} disabled={busy} />
        <Button variant="primary" type="submit" fullWidth disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Jatuh Tempo'}</Button>
      </form>
    </Modal>
    <Modal id="receivable-history" isOpen={!!detail} title="Riwayat Piutang" maxWidth={760} onClose={() => setDetail(null)}>
      {detail && <><p><strong>{detail.customer_name}</strong><small className="receivable-modal-invoice">{detail.invoice_number}</small></p>
        <div className="receivable-detail-totals"><span>Tagihan <strong>{formatRp(detail.total_amount)}</strong></span><span>Terbayar <strong>{formatRp(detail.total_paid)}</strong></span><span>Sisa <strong>{formatRp(detail.remaining)}</strong></span></div>
        <h4>Barang Pesanan</h4>
        <Table columns={[{ key: 'item_name', label: 'Barang' }, { key: 'qty', label: 'Qty' }, { key: 'subtotal', label: 'Subtotal', render: row => formatRp(row.subtotal) }]} data={detail.items} />
        {detail.notes && <p className="receivable-notes">{detail.notes}</p>}
        <h4 className="receivable-history-heading">Riwayat Pembayaran</h4>
        <Table columns={[{ key: 'created_at', label: 'Tanggal', render: row => dateLabel(row.created_at) }, { key: 'payment_method', label: 'Metode' }, { key: 'amount', label: 'Nominal', render: row => formatRp(row.amount) }]} data={detail.payments} emptyText="Belum ada pembayaran." />
      </>}
    </Modal>
  </div>;
}
