import { useState } from 'react';
import Button from './Button/Button';
import Alert from './Alert/Alert';

export default function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState(null);
  const saveBackup = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!window.api?.backupDatabase) throw new Error('Tutup dan buka ulang aplikasi untuk memuat fitur backup.');
      const result = await window.api.backupDatabase();
      if (result?.canceled) return;
      if (!result?.success) throw new Error(result?.message || 'Gagal membuat backup database.');
      setBackup(result);
    } catch (backupError) { setError(backupError.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 700, margin: 0 }}>
      <h3>Backup Data</h3>
      <p>Simpan produk, pelanggan, pesanan, pembayaran, akun pengguna, dan pengaturan dalam file database SQLite. Gambar produk tersimpan terpisah.</p>
      <Alert>{error}</Alert>
      {backup && <Alert variant="success">Backup berhasil disimpan di <span style={{ overflowWrap: 'anywhere' }}>{backup.path}</span> ({Math.ceil(backup.size / 1024)} KB).</Alert>}
      <Button variant="primary" icon="fas fa-download" disabled={busy} onClick={saveBackup}>{busy ? 'Menyiapkan backup...' : 'Backup Database'}</Button>
    </div>
  );
}
