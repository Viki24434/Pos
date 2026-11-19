export const DEFAULT_BARCODE_SETTINGS={width:400,height:160,font_size:14,show_name:true,show_variant:true,show_code:true,show_price:false,show_store:false,show_category:false,show_unit:false,custom_text:'',positions:{}};
export const BARCODE_ELEMENT_KEYS=['barcode','store','name','variant','category','unit','code','price','custom_text'];
export const BARCODE_FIELDS=[{key:'show_name',label:'Nama produk'},{key:'show_variant',label:'Nama varian'},{key:'show_code',label:'Angka / kode barcode'},{key:'show_price',label:'Harga jual biasa'},{key:'show_store',label:'Nama toko'},{key:'show_category',label:'Kategori'},{key:'show_unit',label:'Satuan'}];
export function normalizeBarcodeSettings(input={}) {
    if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Pengaturan barcode tidak valid.');
    const result={...DEFAULT_BARCODE_SETTINGS};
    for(const [key,min,max,label] of [['width',120,2400,'Lebar'],['height',80,1600,'Tinggi'],['font_size',10,28,'Ukuran teks']]){
        const value=Number(input[key] ?? result[key]);
        if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${label} harus ${min}–${max} piksel.`);
        result[key]=value;
    }
    for(const {key} of BARCODE_FIELDS){if(input[key]!=null && typeof input[key]!=='boolean')throw new Error('Pilihan isi barcode tidak valid.');result[key]=input[key] ?? result[key];}
    if(input.custom_text!=null && (typeof input.custom_text!=='string' || input.custom_text.length>120))throw new Error('Teks tambahan maksimal 120 karakter.');
    result.custom_text=String(input.custom_text ?? '').trim();
    result.positions={};
    if(input.positions!=null){
        if(typeof input.positions!=='object'||Array.isArray(input.positions))throw new Error('Posisi label tidak valid.');
        for(const [key,point] of Object.entries(input.positions)){
            if(!BARCODE_ELEMENT_KEYS.includes(key)||!point||typeof point!=='object'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)throw new Error('Posisi label harus berada di dalam gambar.');
            result.positions[key]={x:Math.round(point.x*1000000)/1000000,y:Math.round(point.y*1000000)/1000000};
        }
    }
    return result;
}
