import { useId } from 'react';
import Input from '../../components/Input/Input';

export default function BonusPromotion({ value, onChange }) {
  const id = useId();
  const enabled = Boolean(value.buy_qty || value.free_qty);
  const revealInvalid = event => { event.currentTarget.closest('details').open = true; };
  return <details className="bonus-editor wholesale-editor">
    <summary>Beli X gratis Y <span>{enabled ? `Beli ${value.buy_qty || '…'} gratis ${value.free_qty || '…'}` : 'Opsional'}</span></summary>
    <label className="bonus-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked ? { buy_qty: 2, free_qty: 1 } : { buy_qty: 0, free_qty: 0 })} /> Aktifkan promo
    </label>
    {enabled && <>
      <p>Bonus barang yang sama, berlaku kelipatan. Bisa digabung harga grosir dan VIP.</p>
      <div className="bonus-fields">
        <Input label="Beli" aria-label="Jumlah beli untuk promo" type="number" min="1" step="1" required onInvalid={revealInvalid} value={value.buy_qty} onChange={event => onChange({ buy_qty: event.target.value, free_qty: value.free_qty })} />
        <Input label="Gratis" aria-label="Jumlah gratis untuk promo" type="number" min="1" step="1" required onInvalid={revealInvalid} value={value.free_qty} onChange={event => onChange({ buy_qty: value.buy_qty, free_qty: event.target.value })} />
      </div>
    </>}
  </details>;
}
