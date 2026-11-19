import {useEffect,useState} from 'react';
import Modal from '../Modal/Modal';
import Button from '../Button/Button';
import Select from '../Select/Select';
import Alert from '../Alert/Alert';
import './BarcodeLabel.css';
import {Link} from 'react-router-dom';
import {useAuth} from '../../context/AuthContext';

export default function BarcodeLabel({product,onClose,onCodeCreated}) {
  const {can}=useAuth();
  const [selected,setSelected]=useState('');
  const [revision,setRevision]=useState(0);
  const [created,setCreated]=useState({});
  const [preview,setPreview]=useState(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const variant=product.variants?.find(row=>String(row.id)===selected);
  const missingCode=variant && !variant.sku && !created[selected];
  useEffect(()=>{
    let active=true;
    const request={product_id:product.id,variant_id:selected?Number(selected):null};
    Promise.resolve().then(async()=>{
      if(!window.api.previewProductBarcode)throw new Error('Buka ulang aplikasi untuk memuat pembuat barcode.');
      const result=await window.api.previewProductBarcode(request);
      if(!result?.success)throw new Error(result?.message || 'Gagal membuat barcode.');
      if(active){setPreview({...result,request});setError('');}
    }).catch(failure=>{if(active){setPreview(null);setError(failure.message);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[product.id,selected,revision]);
  const generateCode=async()=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const result=await window.api.createVariantBarcode({product_id:product.id,variant_id:Number(selected)});
      if(!result?.success)throw new Error(result?.message || 'Gagal membuat kode.');
      setCreated(previous=>({...previous,[selected]:result.code}));setLoading(true);setRevision(value=>value+1);onCodeCreated?.();
    }catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  const save=async()=>{
    if(busy || !preview)return;setBusy(true);setError('');setNotice('');
    try{
      const result=await window.api.saveProductBarcode({...preview.request,expected_code:preview.code,expected_settings:preview.settings});
      if(!result?.success)throw new Error(result?.message || 'Gagal menyimpan barcode.');
      if(!result.canceled)setNotice('Gambar barcode tersimpan.');
    }catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  return <Modal id="barcode-label-modal" isOpen title="Buat Gambar Barcode" maxWidth={760} onClose={()=>{if(!busy)onClose();}}>
    <p className="barcode-product-name">{product.name}</p><Alert>{error}</Alert><Alert variant="success">{notice}</Alert>
    {!!product.variants?.length && <Select id="barcode-label-variant" label="Produk / Varian" value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setPreview(null);setLoading(true);setError('');setNotice('');}}><option value="">Kode produk (pilih varian saat scan)</option>{product.variants.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</Select>}
    {missingCode && <Button variant="secondary" disabled={busy} onClick={generateCode}>Buat Kode Varian</Button>}
    <p className="barcode-settings-hint">Ukuran dan isi label mengikuti Pengaturan Toko.{can('settings.manage') && <> <Link to="/settings" onClick={onClose}>Atur barcode</Link></>}</p>
    <div className="barcode-preview" aria-busy={loading}>{loading?<p>Membuat barcode...</p>:preview?<img src={preview.image} alt={`Barcode ${preview.code}`} />:<p>Pratinjau belum tersedia.</p>}</div>
    {preview && <p className="barcode-image-info">{preview.code} · {preview.width} × {preview.height} px · PNG · Code 128</p>}
    <Button variant="primary" icon="fas fa-download" fullWidth disabled={busy || loading || !preview} onClick={save}>{busy?'Memproses...':'Simpan PNG'}</Button>
  </Modal>;
}
