import {useEffect,useRef,useState} from 'react';
import Modal from '../Modal/Modal';
import Button from '../Button/Button';
import Alert from '../Alert/Alert';
import './BarcodeScanner.css';

export default function BarcodeScanner({onResult,onClose}) {
  const video=useRef(null),stream=useRef(null),controls=useRef(null),active=useRef(true),found=useRef(false);
  const [running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const stop=()=>{controls.current?.stop();stream.current?.getTracks().forEach(track=>track.stop());controls.current=null;stream.current=null;};
  useEffect(()=>{active.current=true;return()=>{active.current=false;stop();};},[]);
  const deliver=value=>{if(!active.current || found.current)return;found.current=true;stop();onResult(value);};
  const start=async()=>{
    if(busy || running)return;setError('');setBusy(true);
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kamera tidak tersedia. Gunakan scanner atau gambar.');
      const {BrowserMultiFormatReader}=await import('@zxing/browser');
      if(!active.current)return;
      const capture=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(!active.current){capture.getTracks().forEach(track=>track.stop());return;}
      stream.current=capture;setRunning(true);
      const scanning=await new BrowserMultiFormatReader().decodeFromStream(capture,video.current,(result,_error,scanner)=>{
        if(result){scanner.stop();deliver(result.getText());}
      });
      if(!active.current || found.current)scanning.stop();else controls.current=scanning;
    }catch(failure){stop();if(active.current){setRunning(false);setError(failure.name==='NotAllowedError'?'Akses kamera ditolak. Izinkan kamera atau pilih gambar.':failure.name==='NotFoundError'?'Kamera tidak ditemukan. Gunakan scanner atau gambar.':failure.message || 'Gagal membuka kamera.');}}
    finally{if(active.current)setBusy(false);}
  };
  const readImage=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file || busy)return;
    stop();setRunning(false);setError('');setBusy(true);
    let url;
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024)throw new Error('Pilih gambar PNG, JPG, atau WebP maksimal 10 MB.');
      const {BrowserMultiFormatReader}=await import('@zxing/browser');
      url=URL.createObjectURL(file);
      const result=await new BrowserMultiFormatReader().decodeFromImageUrl(url);deliver(result.getText());
    }catch{if(active.current)setError('Barcode tidak terbaca. Pilih gambar yang jelas (PNG, JPG, WebP; maks. 10 MB).');}
    finally{if(url)URL.revokeObjectURL(url);if(active.current)setBusy(false);}
  };
  return <Modal id="barcode-scanner-modal" isOpen title="Scan Barcode" maxWidth={620} onClose={onClose}>
    <Alert>{error}</Alert><p className="barcode-scan-help">Arahkan kamera ke barcode atau pilih gambar.</p>
    <video ref={video} className="barcode-camera" autoPlay muted playsInline hidden={!running} />
    <div className="barcode-scan-actions"><Button variant="primary" disabled={busy || running} onClick={start} icon="fas fa-camera">{busy?'Memproses...':'Mulai Kamera'}</Button>{running && <Button variant="secondary" onClick={()=>{stop();setRunning(false);}}>Hentikan Kamera</Button>}
      <label className="barcode-file-button">Pilih Gambar<input id="barcode-image-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={readImage} /></label>
    </div>
  </Modal>;
}
