import { useEffect, useState } from 'react';
import Input from '../Input/Input';
import Select from '../Select/Select';
import Button from '../Button/Button';
import Alert from '../Alert/Alert';
import { formatRp } from '../../utils/format';

export default function PaymentForm({ total, allowUnpaid = false, busy, error, onSubmit }) {
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('');
  const [nominal, setNominal] = useState(String(total));
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    window.api.getPaymentMethods().then(rows => {
      if (!active) return;
      setMethods(rows);
      setMethod(rows.find(row => row.kind === 'cash')?.name || rows[0]?.name || '');
    }).catch(() => { if (active) setFormError('Gagal memuat metode pembayaran.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const amount = Number(nominal);
  const isCash = methods.find(row => row.name === method)?.kind === 'cash';
  const applied = Number.isFinite(amount) ? Math.min(Math.max(0, amount), total) : 0;
  const remaining = Math.max(0, Math.round((total - applied) * 100) / 100);
  const change = isCash ? Math.max(0, Math.round((amount - total) * 100) / 100) : 0;

  const submit = event => {
    event.preventDefault();
    if (busy) return;
    setFormError('');
    if (nominal.trim() === '' || !Number.isFinite(amount) || amount < 0 || (!allowUnpaid && amount <= 0)) {
      setFormError(allowUnpaid ? 'Isi nominal bayar minimal 0.' : 'Nominal bayar harus lebih dari 0.');
      return;
    }
    if (amount > 0 && !method) { setFormError('Pilih metode bayar yang aktif melalui Pengaturan.'); return; }
    if (!isCash && amount > total) { setFormError('Pembayaran nontunai tidak boleh melebihi tagihan.'); return; }
    onSubmit({ amount: applied, method });
  };

  return (
    <form onSubmit={submit}>
      <Alert>{error || formError}</Alert>
      <Input label="Tagihan" value={formatRp(total)} readOnly />
      <Select id="payment-method" label="Metode Pembayaran" value={method} disabled={busy || loading} onChange={event => { setMethod(event.target.value); setFormError(''); }}>
        {!methods.length && <option value="">{loading ? 'Memuat metode...' : 'Tidak ada metode aktif'}</option>}
        {methods.map(row => <option key={row.id} value={row.name}>{row.name}</option>)}
      </Select>
      <Input id="payment-amount" label={isCash ? 'Uang Diterima (Rp)' : 'Nominal Bayar (Rp)'} type="number" min={allowUnpaid ? '0' : '0.01'} step="0.01" required value={nominal} disabled={busy} onChange={event => { setNominal(event.target.value); setFormError(''); }} />
      <Button variant="secondary" disabled={busy} onClick={() => setNominal(String(total))}>Lunaskan</Button>
      {allowUnpaid && <Button variant="secondary" disabled={busy} onClick={() => setNominal('0')} style={{ marginLeft: 8 }}>Bayar Nanti</Button>}
      <div style={{ margin: '16px 0', display: 'grid', gap: 8 }}>
        <div>Sisa Tagihan: <strong>{formatRp(remaining)}</strong></div>
        {isCash && <div>Kembalian: <strong>{formatRp(change)}</strong></div>}
        <div>Status: <strong>{remaining === 0 ? 'Lunas' : applied > 0 ? 'DP' : 'Belum Bayar'}</strong></div>
      </div>
      <Button type="submit" variant="success" fullWidth disabled={busy || loading}>{busy ? 'Menyimpan...' : allowUnpaid ? 'Simpan Pesanan & Pembayaran' : 'Simpan Pembayaran'}</Button>
    </form>
  );
}
