import { useEffect, useRef, useState } from 'react';
import Input from '../Input/Input';
import Select from '../Select/Select';
import Button from '../Button/Button';
import Alert from '../Alert/Alert';
import { formatRp } from '../../utils/format';
import { fetchPaymentMethods } from '../../utils/paymentMethods';

export default function PaymentForm({ total, allowUnpaid = false, busy, error, onSubmit }) {
  const [methods, setMethods] = useState([]);
  const [rows, setRows] = useState([{ key: 0, method: '', nominal: String(total) }]);
  const nextKey = useRef(1);
  const [formError, setFormError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchPaymentMethods().then(items => {
      if (!active) return;
      setMethods(items);
      const firstMethod = items.find(item => item.kind === 'cash')?.name || items[0]?.name || '';
      setRows(previous => previous.map(row => ({ ...row, method: row.method || firstMethod })));
    }).catch(methodError => { if (active) setLoadError(methodError.message || 'Gagal memuat metode pembayaran.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const totalCents = Math.round(total * 100);
  const entered = rows.map(row => ({ ...row, amount: Number(row.nominal),
    isCash: methods.find(item => item.name === row.method)?.kind === 'cash' }));
  const cents = entry => Number.isFinite(entry.amount) ? Math.max(0, Math.round(entry.amount * 100)) : 0;
  const nonCash = entered.filter(entry => !entry.isCash).reduce((sum, entry) => sum + cents(entry), 0);
  const cash = entered.filter(entry => entry.isCash).reduce((sum, entry) => sum + cents(entry), 0);
  const applied = Math.min(totalCents, cash + nonCash);
  const remaining = Math.max(0, totalCents - applied) / 100;
  const change = cash > 0 ? Math.max(0, cash + nonCash - totalCents) / 100 : 0;

  const changeRow = (key, field, value) => {
    setRows(previous => previous.map(row => row.key === key ? { ...row, [field]: value } : row));
    setFormError('');
  };
  const addRow = () => {
    const key = nextKey.current++;
    setRows(previous => [...previous, { key, method: methods[0]?.name || '', nominal: String(remaining) }]);
    setFormError('');
  };
  const payLater = () => {
    setRows(previous => [{ ...previous[0], nominal: '0' }]);
    setFormError('');
  };
  const settle = () => {
    const otherCents = entered.slice(1).reduce((sum, entry) => sum + cents(entry), 0);
    changeRow(rows[0].key, 'nominal', String(Math.max(0, totalCents - otherCents) / 100));
  };

  const submit = event => {
    event.preventDefault();
    if (busy || loading || loadError) return;
    setFormError('');
    if (allowUnpaid && entered.length === 1 && entered[0].nominal.trim() !== '' && entered[0].amount === 0) {
      onSubmit({ payments: [], amount: 0, method: '' });
      return;
    }
    if (entered.some(entry => entry.nominal.trim() === '' || !Number.isFinite(entry.amount) || entry.amount <= 0)) {
      setFormError('Isi nominal lebih dari 0 pada setiap pembayaran, atau gunakan Bayar Nanti.');
      return;
    }
    if (entered.some(entry => !methods.some(item => item.name === entry.method))) {
      setFormError('Pilih metode bayar yang aktif melalui Pengaturan.');
      return;
    }
    if (nonCash > totalCents) { setFormError('Pembayaran nontunai tidak boleh melebihi tagihan.'); return; }
    let cashRemaining = totalCents - nonCash;
    const payments = entered.map(entry => {
      const amount = entry.isCash ? Math.min(cents(entry), cashRemaining) : cents(entry);
      if (entry.isCash) cashRemaining -= amount;
      return { method: entry.method, amount: amount / 100 };
    }).filter(entry => entry.amount > 0);
    onSubmit({ payments, amount: applied / 100, method: payments[0]?.method || '' });
  };

  return (
    <form onSubmit={submit}>
      <Alert>{loadError || error || formError}</Alert>
      <Input label="Tagihan" value={formatRp(total)} readOnly />
      {rows.map((row, index) => {
        const isCash = entered[index].isCash;
        return (
          <div key={row.key} className="payment-entry" style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong>Pembayaran {index + 1}</strong>
              {rows.length > 1 && <Button variant="danger" disabled={busy} onClick={() => { setRows(previous => previous.filter(item => item.key !== row.key)); setFormError(''); }}>Hapus</Button>}
            </div>
            <Select id={index === 0 ? 'payment-method' : `payment-method-${row.key}`} label="Metode Pembayaran" value={row.method} disabled={busy || loading || !!loadError} onChange={event => changeRow(row.key, 'method', event.target.value)}>
              {!methods.length && <option value="">{loading ? 'Memuat metode...' : 'Tidak ada metode aktif'}</option>}
              {methods.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
            </Select>
            <Input id={index === 0 ? 'payment-amount' : `payment-amount-${row.key}`} label={isCash ? 'Uang Diterima (Rp)' : 'Nominal Bayar (Rp)'} type="number" min={allowUnpaid ? '0' : '0.01'} step="0.01" required value={row.nominal} disabled={busy} onChange={event => changeRow(row.key, 'nominal', event.target.value)} />
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" disabled={busy || loading || !!loadError || rows.length >= 20} onClick={addRow}>Tambah Pembayaran</Button>
        <Button variant="secondary" disabled={busy} onClick={settle}>Lunaskan</Button>
        {allowUnpaid && <Button variant="secondary" disabled={busy} onClick={payLater}>Bayar Nanti</Button>}
      </div>
      <div style={{ margin: '16px 0', display: 'grid', gap: 8 }}>
        <div>Total Dibayar: <strong>{formatRp(applied / 100)}</strong></div>
        <div>Sisa Tagihan: <strong>{formatRp(remaining)}</strong></div>
        {cash > 0 && <div>Kembalian: <strong>{formatRp(change)}</strong></div>}
        <div>Status: <strong>{remaining === 0 ? 'Lunas' : applied > 0 ? 'DP' : 'Belum Bayar'}</strong></div>
      </div>
      <Button type="submit" variant="success" fullWidth disabled={busy || loading || !!loadError}>{busy ? 'Menyimpan...' : allowUnpaid ? 'Simpan Pesanan & Pembayaran' : 'Simpan Pembayaran'}</Button>
    </form>
  );
}
