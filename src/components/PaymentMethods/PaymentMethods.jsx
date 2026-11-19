import { useEffect, useState } from 'react';
import Input from '../Input/Input';
import Button from '../Button/Button';
import Table from '../Table/Table';
import Alert from '../Alert/Alert';
import { fetchPaymentMethods } from '../../utils/paymentMethods';

export default function PaymentMethods() {
  const [methods, setMethods] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetchPaymentMethods({ includeInactive: true }).then(rows => {
      if (active) setMethods(rows || []);
    }).catch(loadError => { if (active) setError(loadError.message || 'Gagal memuat metode bayar.'); });
    return () => { active = false; };
  }, []);

  const mutate = async operation => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan metode bayar.');
      setMethods(await fetchPaymentMethods({ includeInactive: true }));
      setName('');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card settings-card">
      <h3>Metode Pembayaran</h3>
      <p>Tambahkan metode seperti debit, DANA, atau ShopeePay. Metode tambahan masuk ke saldo Metode Lain pada rekap keuangan.</p>
      <Alert>{error}</Alert>
      <form onSubmit={event => { event.preventDefault(); mutate(() => window.api.createPaymentMethod({ name })); }} className="settings-payment-add">
        <div className="settings-payment-name"><Input id="payment-method-name" label="Nama Metode" placeholder="Contoh: DANA" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></div>
        <Button type="submit" disabled={busy}>Tambah Metode</Button>
      </form>
      <Table columns={[{ key: 'name', label: 'Metode' }, { key: 'active', label: 'Status', render: row => row.active ? 'Aktif' : 'Nonaktif' }]} data={methods}
        renderActions={row => <Button disabled={busy} variant="secondary" onClick={() => mutate(() => window.api.setPaymentMethodActive(row.id, !row.active))}>{row.active ? 'Nonaktifkan' : 'Aktifkan'}</Button>} />
    </div>
  );
}
