import { useId } from 'react';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';

export default function WholesalePrices({ value = [], onChange }) {
  const id = useId();
  const update = (index, field, next) => onChange(value.map((tier, position) => position === index ? { ...tier, [field]: next } : tier));
  const revealInvalid = event => { event.currentTarget.closest('details').open = true; };
  return <details className="wholesale-editor">
    <summary>Harga grosir <span>{value.length ? `${value.length} tingkat` : 'Opsional'}</span></summary>
    <p>Harga per satuan berlaku saat jumlah minimal terpenuhi. VIP memakai harga termurah.</p>
    {value.map((tier, index) => <div className="wholesale-tier" key={index}>
      <Input id={`${id}-qty-${index}`} label="Minimal jumlah" aria-label={`Minimal jumlah grosir tingkat ${index + 1}`} type="number" min="2" step="1" required onInvalid={revealInvalid} value={tier.min_qty} onChange={event => update(index, 'min_qty', event.target.value)} />
      <Input id={`${id}-price-${index}`} label="Harga per satuan (Rp)" aria-label={`Harga grosir per satuan tingkat ${index + 1}`} type="number" min="0" step="0.01" required onInvalid={revealInvalid} value={tier.price} onChange={event => update(index, 'price', event.target.value)} />
      <Button variant="danger" aria-label={`Hapus harga grosir ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><i className="fas fa-trash" /></Button>
    </div>)}
    <Button variant="secondary" disabled={value.length >= 20} icon="fas fa-plus" onClick={() => onChange([...value, { min_qty: '', price: '' }])}>Tambah Tingkat Harga</Button>
  </details>;
}
