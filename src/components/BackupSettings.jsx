import { useState } from 'react';
import Button from './Button/Button';
import Alert from './Alert/Alert';
import Modal from './Modal/Modal';

export default function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    if (busy || restoring) return;
    setRestoring(true);
    setError('');
    try {
      if (!window.api?.restoreDatabase) throw new Error('Tutup dan buka ulang aplikasi untuk memuat fitur pemulihan.');
      const result = await window.api.restoreDatabase();
      if (result?.canceled) return;
      if (!result?.success) throw new Error(result?.message || 'Gagal memulihkan backup.');
      localStorage.removeItem('pos_session');
      window.alert(`Backup berhasil dipulihkan. Cadangan data sebelumnya tersimpan di ${result.safetyPath}. Silakan login kembali.`);
      window.location.hash = '/login';
      window.location.reload();
    } catch (restoreError) { setError(restoreError.message); }
    finally { setRestoring(false); }
  };
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
    <div className="card settings-card backup-card">
      <h3>Backup Data</h3>
      <Alert>{error}</Alert>
      {backup && <Alert variant="success">
        <strong>Backup berhasil disimpan</strong>
        <span className="backup-file-path">{backup.path}</span>
        <small>{Math.ceil(backup.size / 1024)} KB</small>
      </Alert>}
      <div className="backup-actions">
        <section className="backup-action">
          <div>
            <h4>Simpan Cadangan</h4>
            <p>Simpan salinan data aplikasi ke file .sqlite di lokasi pilihan Anda.</p>
          </div>
          <Button variant="primary" icon="fas fa-download" disabled={busy || restoring} onClick={saveBackup}>{busy ? 'Menyiapkan backup...' : 'Backup Database'}</Button>
        </section>
        <section className="backup-action">
          <div>
            <h4>Pulihkan Data</h4>
            <p>Kembalikan data dari file backup. Data saat ini dicadangkan otomatis sebelum pemulihan, lalu Anda diminta login ulang.</p>
          </div>
          <Button variant="secondary" icon="fas fa-upload" disabled={busy || restoring} onClick={restore}>Pulihkan Backup</Button>
        </section>
      </div>
      <p className="backup-note">Backup mencakup produk, pelanggan, pesanan, pembayaran, akun, dan pengaturan. Gambar produk dicadangkan terpisah.</p>
      <Modal isOpen={restoring} title="Pemulihan Backup" onClose={() => {}}>
        <p>Ikuti dialog pemilihan dan konfirmasi. Tunggu sampai proses pemulihan selesai.</p>
      </Modal>
    </div>
  );
}
