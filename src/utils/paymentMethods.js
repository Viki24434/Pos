export async function fetchPaymentMethods(options) {
  if (typeof window.api?.getPaymentMethods !== 'function') {
    throw new Error('Modul pembayaran belum dimuat. Tutup dan buka ulang aplikasi.');
  }
  const rows = await window.api.getPaymentMethods(options);
  if (!Array.isArray(rows)) throw new Error('Daftar metode pembayaran tidak valid. Jalankan ulang aplikasi.');
  return rows;
}
