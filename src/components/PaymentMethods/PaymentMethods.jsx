import { useEffect, useState } from 'react';
import Input from '../Input/Input';
import Button from '../Button/Button';
import Table from '../Table/Table';
import Alert from '../Alert/Alert';

export default function PaymentMethods() {
  const [methods, setMethods] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    window.api.getPaymentMethods({ includeInactive: true }).then(rows => {
      if (active) setMethods(rows || []);
    }).catch(() => { if (active) setError('Gagal memuat metode bayar.'); });
    return () => { active = false; };
  }, []);

  const mutate = async operation => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan metode bayar.');
      setMethods(await window.api.getPaymentMethods({ includeInactive: true }));
      setName('');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 700, margin: 0 }}>
      <h3>Metode Pembayaran</h3>
      <p>Tambahkan metode seperti debit, DANA, atau ShopeePay. Metode tambahan masuk ke saldo Metode Lain pada rekap keuangan.</p>
      <Alert>{error}</Alert>
      <form onSubmit={event => { event.preventDefault(); mutate(() => window.api.createPaymentMethod({ name })); }} style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}><Input id="payment-method-name" label="Nama Metode" placeholder="Contoh: DANA" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></div>
        <Button type="submit" disabled={busy} style={{ marginBottom: 16 }}>Tambah Metode</Button>
      </form>
      <Table columns={[{ key: 'name', label: 'Metode' }, { key: 'active', label: 'Status', render: row => row.active ? 'Aktif' : 'Nonaktif' }]} data={methods}
        renderActions={row => <Button disabled={busy} variant="secondary" onClick={() => mutate(() => window.api.setPaymentMethodActive(row.id, !row.active))}>{row.active ? 'Nonaktifkan' : 'Aktifkan'}</Button>} />
    </div>
  );
}
