import { useEffect, useState } from 'react';
import Select from './Select/Select';
import Button from './Button/Button';
import Alert from './Alert/Alert';

export default function PrintSettings() {
  const [form, setForm] = useState({ receipt_paper: '80mm', printer_name: '', print_direct: false });
  const [printers, setPrinters] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!window.api?.getPrintSettings || !window.api?.getPrinters) throw new Error('Tutup dan buka ulang aplikasi untuk memuat pengaturan thermal.');
        const [saved, available] = await Promise.all([window.api.getPrintSettings(), window.api.getPrinters()]);
        if (!active) return;
        setForm({ receipt_paper: saved?.receipt_paper || '80mm', printer_name: saved?.printer_name || '', print_direct: !!saved?.print_direct });
        setPrinters(available);
        setReady(true);
      } catch (loadError) { if (active) setError(loadError.message); }
    })();
    return () => { active = false; };
  }, []);
  const save = async event => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await window.api.savePrintSettings(form);
      if (!result?.success) throw new Error(result?.message || 'Gagal menyimpan pengaturan thermal.');
      setMessage('Pengaturan thermal disimpan dan otomatis digunakan saat mencetak.');
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      <h3>Pengaturan Thermal / Printer</h3>
      <Alert>{error}</Alert><Alert variant="success">{message}</Alert>
      <form onSubmit={save}>
        <Select id="receipt-paper-setting" label="Ukuran Kertas Struk" value={form.receipt_paper} disabled={!ready || busy} onChange={event => setForm({ ...form, receipt_paper: event.target.value })}>
          <option value="58mm">Thermal 58 mm</option><option value="80mm">Thermal 80 mm</option><option value="A4">A4</option>
        </Select>
        <Select id="receipt-printer-setting" label="Printer Struk" value={form.printer_name} disabled={!ready || busy} onChange={event => setForm({ ...form, printer_name: event.target.value, print_direct: event.target.value ? form.print_direct : false })}>
          <option value="">Printer default Windows / Pilih melalui dialog</option>
          {form.printer_name && !printers.some(printer => printer.name === form.printer_name) && <option value={form.printer_name}>{form.printer_name} (tidak tersedia)</option>}
          {printers.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}
        </Select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input id="receipt-direct-setting" type="checkbox" checked={form.print_direct} disabled={!ready || busy || !form.printer_name} onChange={event => setForm({ ...form, print_direct: event.target.checked })} />
          Cetak langsung ke printer tersimpan tanpa dialog
        </label>
        <Button type="submit" variant="success" disabled={!ready || busy}>{busy ? 'Menyimpan...' : 'Simpan Pengaturan Thermal'}</Button>
      </form>
    </div>
  );
}
