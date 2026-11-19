import {useEffect,useRef,useState} from 'react';
import Button from './Button/Button';
import Input from './Input/Input';
import Alert from './Alert/Alert';
import {DEFAULT_BARCODE_SETTINGS,BARCODE_FIELDS} from '../../shared/barcode-settings';
import './BarcodeLabel/BarcodeLabel.css';
import BarcodeLayoutEditor from './BarcodeLabel/BarcodeLayoutEditor';

export default function BarcodeSettings(){
  const [form,setForm]=useState(DEFAULT_BARCODE_SETTINGS);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState(null);
  const [previewError,setPreviewError]=useState(''),[previewLoading,setPreviewLoading]=useState(true);
  const previewVersion=useRef(0);
  useEffect(()=>{
    let active=true;
    Promise.resolve().then(async()=>{
      if(!window.api.getBarcodeSettings)throw new Error('Buka ulang aplikasi untuk memuat pengaturan barcode.');
      const settings=await window.api.getBarcodeSettings();
      if(active){setForm(settings);setReady(true);}
    }).catch(failure=>{if(active){setError(failure.message);setPreviewLoading(false);}});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!ready)return;
    let active=true;
    const version=previewVersion.current;
    const timer=setTimeout(async()=>{
      try{
        const image=await window.api.previewBarcodeSettings(form);
        if(!image?.success)throw new Error(image?.message || 'Gagal membuat pratinjau.');
        if(active && previewVersion.current===version){setPreview({...image,editorRevision:version});setPreviewError((image.warnings || []).join(' '));}
      }catch(failure){if(active && previewVersion.current===version){setPreview(null);setPreviewError(failure.message);}}
      finally{if(active && previewVersion.current===version)setPreviewLoading(false);}
    },200);
    return()=>{active=false;clearTimeout(timer);};
  },[form,ready]);
  const change=(key,value)=>{previewVersion.current++;setForm(previous=>({...previous,[key]:value}));setPreviewLoading(true);setPreviewError('');setNotice('');setError('');};
  const submit=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const result=await window.api.saveBarcodeSettings(form);
      if(!result?.success)throw new Error(result?.message || 'Gagal menyimpan barcode.');
      previewVersion.current++;setPreviewLoading(true);setForm(result.settings);setNotice('Pengaturan barcode tersimpan.');
    }catch(failure){setError(failure.message);}finally{setBusy(false);}
  };
  return <div className="card settings-card barcode-settings-card">
    <h3>Pengaturan Barcode</h3><Alert>{error}</Alert><Alert variant="success">{notice}</Alert>
    <form onSubmit={submit}>
      <fieldset disabled={!ready || busy} className="barcode-settings-fieldset">
        <div className="barcode-dimensions"><Input id="barcode-width" label="Lebar Gambar (px)" type="number" min="120" max="2400" required value={form.width} onChange={event=>change('width',event.target.value)} /><Input id="barcode-height" label="Tinggi Gambar (px)" type="number" min="80" max="1600" required value={form.height} onChange={event=>change('height',event.target.value)} /><Input id="barcode-font-size" label="Ukuran Teks (px)" type="number" min="10" max="28" required value={form.font_size} onChange={event=>change('font_size',event.target.value)} /></div>
        <div className="barcode-content-options">{BARCODE_FIELDS.map(field=><label key={field.key}><input id={`barcode-${field.key}`} type="checkbox" checked={form[field.key]} onChange={event=>change(field.key,event.target.checked)} />{field.label}</label>)}</div>
        <Input id="barcode-custom-text" label="Teks Tambahan (Opsional)" maxLength={120} placeholder="Contoh: Terima kasih telah berbelanja" value={form.custom_text} onChange={event=>change('custom_text',event.target.value)} />
        <div className="barcode-settings-actions"><Button type="submit" variant="success">{busy?'Menyimpan...':'Simpan Pengaturan Barcode'}</Button></div>
      </fieldset>
    </form>
    <Alert>{previewError}</Alert>
    <div className="barcode-layout-toolbar"><span>{preview && !preview.elements?.length?'Buka ulang aplikasi untuk mengaktifkan drag-and-drop.':'Geser tulisan atau barcode untuk memindahkan posisi.'}</span><Button variant="secondary" disabled={!preview?.elements?.length || previewLoading || busy} onClick={()=>change('positions',{})}>Reset Posisi</Button></div>
    <div className="barcode-preview barcode-settings-preview" aria-busy={previewLoading}>
      {preview?<BarcodeLayoutEditor preview={preview} disabled={previewLoading || busy} onMove={(key,point)=>change('positions',{...form.positions,[key]:point})} />:<p>{previewLoading?'Membuat pratinjau...':'Pratinjau belum tersedia.'}</p>}
    </div>
    {previewLoading && preview && <p className="barcode-image-info" role="status">Memperbarui pratinjau...</p>}
    {preview && !previewLoading && <p className="barcode-image-info">{preview.width} × {preview.height} px · Contoh label</p>}
  </div>;
}
