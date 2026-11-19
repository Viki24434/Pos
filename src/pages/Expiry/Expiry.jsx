import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader/PageHeader';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Table from '../../components/Table/Table';
import Modal from '../../components/Modal/Modal';
import Alert from '../../components/Alert/Alert';
import './Expiry.css';

const INITIAL_FILTER={search:'',status:'soon',days:30};
const dateLabel=value=>value ? new Date(value+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}) : 'Belum diisi';
async function fetchBatches(filter) {
  if (!window.api?.getExpiryBatches) throw new Error('Buka ulang aplikasi untuk memuat kedaluwarsa.');
  return window.api.getExpiryBatches(filter);
}
export default function Expiry() {
  const [data,setData]=useState({rows:[],summary:{expired:0,soon:0,undated:0}});
  const [filter,setFilter]=useState(INITIAL_FILTER);
  const [applied,setApplied]=useState(INITIAL_FILTER);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [form,setForm]=useState(null);
  const [formError,setFormError]=useState('');
  useEffect(()=>{
    let active=true;
    fetchBatches(INITIAL_FILTER).then(result=>{if(active) setData(result);}).catch(failure=>{if(active) setError(failure.message);}).finally(()=>{if(active) setLoading(false);});
    return ()=>{active=false;};
  },[]);
  const load=async next=>{
    setError('');setLoading(true);
    try {setData(await fetchBatches(next));}catch(failure){setError(failure.message);}finally{setLoading(false);}
  };
  const open=(row,mode)=>{
    setFormError('');
    setForm({...row,mode,qty:row.remaining_qty,expires_on:row.expires_on || '',reason:row.days_left!=null && row.days_left<0 ? 'Kedaluwarsa' : ''});
  };
  const save=async event=>{
    event.preventDefault();if(busy)return;
    setBusy(true);setFormError('');
    try {
      const result=await (form.mode==='remove'?window.api.removeBatchStock(form):window.api.setBatchExpiry(form));
      if(!result?.success)throw new Error(result?.message || 'Gagal menyimpan batch.');
      setNotice(form.mode==='remove'?'Stok batch sudah dikeluarkan.':'Tanggal dan nomor batch tersimpan.');
      setForm(null);await load(applied);
    }catch(failure){setFormError(failure.message);}finally{setBusy(false);}
  };
  return <div className="expiry-page">
    <PageHeader title="Kedaluwarsa" icon="fas fa-calendar-times" subtitle="Pantau tanggal dan sisa stok setiap batch" />
    <Alert>{error}</Alert><Alert variant="success">{notice}</Alert>
    <div className="expiry-summary">
      <div className="card"><span>Batch Kedaluwarsa</span><strong className="expiry-danger">{data.summary.expired}</strong></div>
      <div className="card"><span>Mendekati Kedaluwarsa ({applied.days} hari)</span><strong>{data.summary.soon}</strong></div>
      <div className="card"><span>Batch Tanpa Tanggal</span><strong>{data.summary.undated}</strong></div>
    </div>
    <div className="card"><form className="expiry-filter" onSubmit={event=>{event.preventDefault();setApplied(filter);load(filter);}}>
      <Input id="expiry-search" label="Pencarian" placeholder="Produk, varian, atau nomor batch" value={filter.search} onChange={event=>setFilter({...filter,search:event.target.value})} />
      <Select id="expiry-status" label="Status" value={filter.status} onChange={event=>setFilter({...filter,status:event.target.value})}><option value="soon">Mendekati kedaluwarsa</option><option value="expired">Sudah kedaluwarsa</option><option value="undated">Tanpa tanggal</option><option value="all">Semua batch</option></Select>
      <Select id="expiry-days" label="Rentang Peringatan" value={filter.days} onChange={event=>setFilter({...filter,days:Number(event.target.value)})}>{[7,14,30,60,90].map(days=><option key={days} value={days}>{days} hari</option>)}</Select>
      <Button type="submit" disabled={loading} icon="fas fa-search">Cari</Button>
    </form></div>
    <div className="card expiry-table"><p className="expiry-help">Stok yang sudah kedaluwarsa tidak tersedia untuk penjualan.</p>
      {loading?<p>Memuat batch...</p>:<Table columns={[
        {key:'product_name',label:'Barang',render:row=><div><strong>{row.product_name}</strong>{row.variant_name && <small>{row.variant_name}</small>}</div>},
        {key:'batch_code',label:'Batch',render:row=>row.batch_code || 'Tanpa nomor'},
        {key:'remaining_qty',label:'Sisa Stok',render:row=><strong>{row.remaining_qty}{row.unit_name ? ` ${row.unit_name}` : ''}</strong>},
        {key:'expires_on',label:'Kedaluwarsa',render:row=>dateLabel(row.expires_on)},
        {key:'days_left',label:'Status',render:row=><span className={row.days_left!=null && row.days_left<0?'expiry-danger':''}>{row.days_left==null?'Tanpa tanggal':row.days_left<0?'Kedaluwarsa':row.days_left===0?'Hari ini':`${row.days_left} hari lagi`}</span>},
      ]} data={data.rows} emptyText="Tidak ada batch sesuai filter." renderActions={row=><div className="expiry-actions"><Button variant="secondary" title="Atur Kedaluwarsa" onClick={()=>open(row,'edit')}>Atur Tanggal</Button><Button variant="danger" title="Keluarkan Stok Batch" onClick={()=>open(row,'remove')}>Keluarkan Stok</Button></div>} />}
    </div>
    <Modal id="expiry-modal" isOpen={!!form} title={form?.mode==='remove'?'Keluarkan Stok Batch':'Atur Batch & Kedaluwarsa'} onClose={()=>{if(!busy)setForm(null);}}>
      {form && <form onSubmit={save}><Alert>{formError}</Alert><p><strong>{form.product_name}{form.variant_name?` - ${form.variant_name}`:''}</strong><small className="expiry-help">Sisa batch: {form.remaining_qty}</small></p>
        <Input id="expiry-quantity" label={form.mode==='remove'?'Jumlah Dikeluarkan':'Jumlah yang Diatur'} type="number" required min="1" max={form.remaining_qty} step="1" value={form.qty} onChange={event=>setForm({...form,qty:event.target.value})} />
        {form.mode==='remove'?<Input id="expiry-reason" label="Alasan *" required value={form.reason} onChange={event=>setForm({...form,reason:event.target.value})} />:<>
          <Input id="expiry-code" label="Nomor Batch (Opsional)" value={form.batch_code} onChange={event=>setForm({...form,batch_code:event.target.value})} />
          <Input id="expiry-date" label="Tanggal Kedaluwarsa (Opsional)" type="date" value={form.expires_on} onChange={event=>setForm({...form,expires_on:event.target.value})} />
        </>}
        <Button type="submit" variant={form.mode==='remove'?'danger':'primary'} fullWidth disabled={busy}>{busy?'Menyimpan...':form.mode==='remove'?'Keluarkan Stok':'Simpan Batch'}</Button>
      </form>}
    </Modal>
  </div>;
}
