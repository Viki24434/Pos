import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import PaymentForm from '../../components/PaymentForm/PaymentForm';
import { useAuth } from '../../context/AuthContext';
import Alert from '../../components/Alert/Alert';
import Modal from '../../components/Modal/Modal';
import Table from '../../components/Table/Table';
import IconButton from '../../components/IconButton/IconButton';
import PageHeader from '../../components/PageHeader/PageHeader';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import { formatRp } from '../../utils/format';
import './Orders.css';

export default function Orders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState({ start: '', end: '', search: '' });
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

  const openReceipt = async (order) => {
    setPrintError('');
    try {
      if (!window.api?.previewReceipt) throw new Error('Tutup dan buka ulang aplikasi untuk memuat fitur cetak.');
      const settings = await window.api.getPrintSettings();
      const paper = settings?.receipt_paper || '80mm';
      const html = await window.api.previewReceipt(order.id);
      setReceipt({ id: order.id, invoice: order.invoice_number || order.invoice, paper, html });
    } catch (printFailure) { setError(printFailure.message || 'Gagal memuat struk.'); }
  };
  const printReceipt = async () => {
    if (printing) return;
    setPrinting(true);
    setPrintError('');
    try {
      const result = await window.api.printReceipt(receipt.id);
      if (!result?.success) setPrintError(result?.message || 'Pencetakan dibatalkan.');
    } catch { setPrintError('Gagal membuka dialog printer. Jalankan ulang aplikasi.'); }
    finally { setPrinting(false); }
  };

  const [detail, setDetail] = useState({ open: false, invoice: '', items: [], payments: [] });
  const [payment, setPayment] = useState({
    open: false, orderId: '', sisa: 0,
  });

  const loadOrders = async () => {
    try {
      const data = await window.api.getOrders(filter);
      setOrders(data || []);
    } catch {
      setError('Gagal memuat data pesanan.');
    }
  };

  useEffect(() => {
    let active = true;
    window.api.getOrders({}).then(data => { if (active) setOrders(data || []); })
      .catch(() => { if (active) setError('Gagal memuat data pesanan.'); });
    return () => { active = false; };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    loadOrders();
  };

  const openDetail = async (id, invoice) => {
    try {
      const [items, payments] = await Promise.all([window.api.getOrderDetail(id), window.api.getOrderPayments(id)]);
      setDetail({ open: true, invoice, items: items || [], payments: payments || [], notes: orders.find(order => order.id === id)?.notes || '' });
    } catch {
      setError('Gagal memuat detail pesanan.');
    }
  };

  const openPayment = order => {
    setPaymentError('');
    setPayment({ open: true, orderId: order.id, sisa: Math.max(0, Math.round((order.total_amount - (order.total_paid || 0)) * 100) / 100) });
  };

  const submitPayment = async ({ amount, method, payments }) => {
    if (paying) return;
    setPaying(true);
    setPaymentError('');
    try {
      const result = await window.api.processPayment({ id: payment.orderId, total: amount, paymentMethod: method, payments, userId: user?.id });
      if (!result?.success) throw new Error(result?.message || 'Gagal memproses pembayaran.');
      setPayment(previous => ({ ...previous, open: false }));
      await loadOrders();
    } catch (saveError) { setPaymentError(saveError.message || 'Gagal memproses pembayaran.'); }
    finally { setPaying(false); }
  };

  const orderColumns = [
    { key: 'invoice_number', label: 'No. Invoice', cellStyle: { fontWeight: 700, color: 'var(--primary)' } },
    { key: 'payment_action', label: 'Pembayaran', render: order => Math.round((order.total_amount - (order.total_paid || 0)) * 100) > 0
      ? <Button variant="success" icon="fas fa-wallet" title="Bayar" disabled={paying} onClick={() => openPayment(order)}>Bayar</Button>
      : <StatusBadge status="Lunas" /> },
    { key: 'customer_name', label: 'Pelanggan', render: (o) => <div><b>{o.customer_name}</b>{o.customer_status && <div style={{ marginTop: 4 }}><StatusBadge status={o.customer_status} /></div>}</div> },
    { key: 'total_amount', label: 'Total Tagihan', render: (o) => formatRp(o.total_amount) },
    { key: 'total_paid', label: 'Terbayar', render: o => formatRp(o.total_paid || 0) },
    { key: 'remaining', label: 'Sisa Tagihan', render: o => formatRp(Math.max(0, o.total_amount - (o.total_paid || 0))) },
    { key: 'payment_status', label: 'Status', headerStyle: { textAlign: 'center' }, cellStyle: { textAlign: 'center' }, render: (o) => <StatusBadge status={o.payment_status} /> },
    { key: 'created_at', label: 'Tanggal', render: (o) => new Date(o.created_at).toLocaleString('id-ID') },
  ];

  const itemColumns = [
    { key: 'item_name', label: 'Item', render: (item) => item.item_name || item.product_name },
    { key: 'qty', label: 'Qty', headerStyle: { textAlign: 'center' }, cellStyle: { textAlign: 'center' } },
    { key: 'price', label: 'Harga', headerStyle: { textAlign: 'right' }, cellStyle: { textAlign: 'right' }, render: (i) => formatRp(i.price) },
    { key: 'subtotal', label: 'Subtotal', headerStyle: { textAlign: 'right' }, cellStyle: { textAlign: 'right' }, render: (i) => formatRp(i.subtotal) },
  ];

  return (
    <div className="orders-page">
      <Alert>{error}</Alert>

      <PageHeader
        title="Riwayat Pesanan"
        subtitle="Daftar seluruh transaksi dan status pembayaran"
        actionLabel="Buat Pesanan Baru"
        actionIcon="fas fa-plus"
        onAction={() => navigate('/orders/create')}
      />

      <div className="card">
        <form onSubmit={handleSearch} className="orders-filter">
          <Input label="Dari Tanggal" type="date" value={filter.start} onChange={(e) => setFilter({ ...filter, start: e.target.value })} />
          <Input label="Sampai Tanggal" type="date" value={filter.end} onChange={(e) => setFilter({ ...filter, end: e.target.value })} />
          <Input
            label="Pencarian"
            placeholder="Cari No. Invoice atau Nama..."
            value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            className="orders-filter-search"
          />
          <Button type="submit" variant="info" icon="fas fa-search">Cari</Button>
        </form>
      </div>

      <div className="card">
        <Table
          columns={orderColumns}
          data={orders}
          emptyText="Tidak ada data pesanan."
          renderActions={(o) => (
            <div className="row-actions">
              <IconButton icon="fas fa-eye" variant="primary" title="Detail" onClick={() => openDetail(o.id, o.invoice_number)} />
              <Button variant="secondary" icon="fas fa-print" title="Cetak Struk" onClick={() => openReceipt(o)}>Cetak</Button>
            </div>
          )}
        />
      </div>

      <Modal
        isOpen={detail.open}
        onClose={() => setDetail({ ...detail, open: false })}
        title={`Detail Pesanan: ${detail.invoice}`}
        maxWidth={700}
      >
        <Table columns={itemColumns} data={detail.items} emptyText="Tidak ada item." />
        {detail.notes && <div className="order-detail-notes"><h4>Catatan Pesanan</h4><p>{detail.notes}</p></div>}
        <h4>Pembayaran Tercatat</h4>
        <Table columns={[
          { key: 'created_at', label: 'Tanggal', render: row => new Date(row.created_at).toLocaleString('id-ID') },
          { key: 'payment_method', label: 'Metode' },
          { key: 'amount', label: 'Nominal', render: row => formatRp(row.amount) },
        ]} data={detail.payments} emptyText="Belum ada pembayaran." />
      </Modal>

      <Modal id="receipt-preview" isOpen={!!receipt} onClose={() => { if (!printing) setReceipt(null); }} title={`Cetak Struk: ${receipt?.invoice || ''}`} maxWidth={800}>
        <Alert>{printError}</Alert>
        <p>Kertas: <strong>{receipt?.paper}</strong>. Pengaturan printer dan thermal mengikuti Pengaturan Toko.</p>
        <iframe title="Pratinjau Struk" sandbox="" srcDoc={receipt?.html || ''} style={{ width: '100%', height: '45vh', border: '1px solid #ddd', background: 'white', marginBottom: 12 }} />
        <Button variant="primary" fullWidth icon="fas fa-print" disabled={printing} onClick={printReceipt}>{printing ? 'Mencetak...' : 'Cetak Struk'}</Button>
      </Modal>
      <Modal id="order-payment" isOpen={payment.open} onClose={() => { if (!paying) setPayment(previous => ({ ...previous, open: false })); }} title="Form Pembayaran" maxWidth={500}>
        <PaymentForm total={payment.sisa} busy={paying} error={paymentError} onSubmit={submitPayment} />
      </Modal>
    </div>
  );
}
