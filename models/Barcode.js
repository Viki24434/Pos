import bwipjs from 'bwip-js';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { withDatabaseWork, withTransaction } from '../config/db.js';
import { normalizeBarcodeSettings } from '../shared/barcode-settings.js';
import {labelFields,placeLabelElement,overlapsBarcode} from '../shared/barcode-layout.js';

const escapeXml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
export async function getBarcodeSettings(){
    return withDatabaseWork(async db=>{
        const store=await db.get('SELECT barcode_settings FROM stores WHERE id=1');
        let saved;try{saved=JSON.parse(store?.barcode_settings || '{}');}catch{saved={};}
        return normalizeBarcodeSettings(saved && typeof saved==='object' && !Array.isArray(saved)?saved:{});
    });
}
export async function previewBarcodeSettings(input){
    const settings=normalizeBarcodeSettings(input);
    const store=await withDatabaseWork(db=>db.get('SELECT name FROM stores WHERE id=1'));
    return renderBarcode({code:'123456',name:'Contoh Produk',product_name:'Contoh Produk',variant_name:'Varian Original',price:15000,store_name:store?.name || 'Nama Toko',category_name:'Kategori',unit_name:'pcs'},settings);
}
export async function saveBarcodeSettings(input){
    const settings=normalizeBarcodeSettings(input);
    const preview=await previewBarcodeSettings(settings);
    if(preview.warnings.length)throw new Error(preview.warnings.join(' '));
    await withTransaction(db=>db.run('UPDATE stores SET barcode_settings=? WHERE id=1',[JSON.stringify(settings)]));
    return settings;
}
export async function barcodeSource(data) {
    return withDatabaseWork(async db=>{
        const product=await db.get('SELECT p.id,p.name,p.product_code,p.price,c.name as category_name,u.name as unit_name,s.name as store_name FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN stores s ON s.id=p.store_id WHERE p.id=? AND p.store_id=1',[data.product_id]);
        if(!product)throw new Error('Produk tidak ditemukan.');
        let code=product.product_code;
        let name=product.name;
        let variantId=null;
        let variantName='';let price=Number(product.price);
        if(data.variant_id!=null && data.variant_id!=='') {
            const variant=await db.get('SELECT id,name,sku,price FROM product_variants WHERE id=? AND product_id=? AND active=1',[data.variant_id,product.id]);
            if(!variant)throw new Error('Varian tidak ditemukan.');
            if(!variant.sku)throw new Error('Varian belum memiliki SKU. Klik Buat Kode Varian.');
            code=variant.sku;name+=' - '+variant.name;variantId=variant.id;
            variantName=variant.name;price=Number(variant.price);
        }
        const conflicts=await db.get(`SELECT COUNT(*) as total FROM (
            SELECT p.id,NULL as variant_id FROM products p WHERE p.store_id=1 AND p.product_code=?
            UNION ALL SELECT v.product_id,v.id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.store_id=1 AND v.active=1 AND v.sku=?
        )`,[code,code]);
        if(conflicts.total>1)throw new Error('Kode barcode digunakan lebih dari satu barang. Ubah kode produk atau SKU.');
        const hasVariants=!variantId && !!await db.get('SELECT id FROM product_variants WHERE product_id=? AND active=1 LIMIT 1',[product.id]);
        return {code,name,product_name:product.name,variant_name:variantName,price,has_variants:hasVariants,store_name:product.store_name || '',category_name:product.category_name || '',unit_name:product.unit_name || '',product_id:product.id,variant_id:variantId};
    });
}

export async function createVariantCode(data) {
    return withTransaction(async db=>{
        const variant=await db.get('SELECT v.id,v.sku FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.product_id=? AND p.store_id=1 AND v.active=1',[data.variant_id,data.product_id]);
        if(!variant)throw new Error('Varian tidak ditemukan.');
        if(variant.sku)return variant.sku;
        let code;
        do {code='V-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();}
        while(await db.get('SELECT id FROM products WHERE product_code=? UNION ALL SELECT id FROM product_variants WHERE sku=? LIMIT 1',[code,code]));
        await db.run('UPDATE product_variants SET sku=? WHERE id=?',[code,variant.id]);
        return code;
    });
}

export function barcodeTextLines(source,settings){
    const top=[];const bottom=[];
    if(settings.show_store && source.store_name)top.push(source.store_name);
    if(settings.show_name && (source.product_name || source.name))top.push(source.product_name || source.name);
    if(settings.show_variant && source.variant_name)top.push(source.variant_name);
    const details=[settings.show_category && source.category_name,settings.show_unit && source.unit_name].filter(Boolean);
    if(details.length)top.push(details.join(' · '));
    if(settings.show_code)bottom.push(String(source.code));
    if(settings.show_price && source.price!=null)bottom.push(`${source.has_variants?'Mulai ':''}Rp ${Number(source.price).toLocaleString('id-ID',{maximumFractionDigits:2})}`);
    if(settings.custom_text)bottom.push(settings.custom_text);
    return {top,bottom};
}
export async function renderBarcode(source, input={}) {
    const settings=normalizeBarcodeSettings(input);
    const {width,height,font_size:fontSize}=settings;
    const code=String(source.code || '');
    if(!/^[\x20-\x7E]{1,80}$/.test(code))throw new Error('Kode barcode harus 1–80 karakter huruf, angka, atau simbol ASCII.');
    const raw=await bwipjs.toBuffer({bcid:'code128',text:code,scale:1,height:10,includetext:false,padding:0,backgroundcolor:'FFFFFF'});
    const rawWidth=(await sharp(raw).metadata()).width;
    const minimum=rawWidth+20;
    if(width<minimum)throw new Error(`Kode ini memerlukan lebar minimal ${minimum} piksel agar dapat dipindai.`);
    const scale=Math.floor(width/minimum);
    const barsWidth=rawWidth*scale;
    const {top,bottom}=labelFields(source,settings);
    const lineHeight=fontSize+8;
    const nameSpace=top.length*lineHeight;
    const barsHeight=height-20-nameSpace-bottom.length*lineHeight;
    if(barsHeight<44)throw new Error(`Tinggi gambar minimal ${64+(top.length+bottom.length)*lineHeight} piksel untuk isi label ini.`);
    const bars=await sharp(raw).resize(barsWidth,barsHeight-16,{fit:'fill',kernel:'nearest'}).png().toBuffer();
    const symbolWidth=barsWidth+20*scale;
    const symbol=await sharp({create:{width:symbolWidth,height:barsHeight,channels:4,background:'#ffffff'}}).composite([{input:bars,left:10*scale,top:8}]).png().toBuffer();
    const elements=[];
    const layers=[];
    const add=(element,buffer,defaultPoint)=>{
        const point=placeLabelElement(element,settings.positions[element.key] || defaultPoint,{width,height});
        // Integer top-left coordinates keep barcode modules aligned with image pixels.
        const left=Math.max(0,Math.min(width-element.width,Math.round(point.x-element.width/2)));
        const top=Math.max(0,Math.min(height-element.height,Math.round(point.y-element.height/2)));
        elements.push({...element,x:left+element.width/2,y:top+element.height/2,image:'data:image/png;base64,'+buffer.toString('base64')});
        layers.push({input:buffer,left,top});
    };
    add({key:'barcode',label:'Barcode',width:symbolWidth,height:barsHeight},symbol,{x:.5,y:(10+nameSpace+barsHeight/2)/height});
    const name=String(source.name || '');
    const line=async(field,centerY)=>{
        if(!field.text)return;
        const size=Math.min(fontSize,(width-20)/Math.max(1,Array.from(field.text).length));
        const svg=Buffer.from(`<svg width="${width}" height="${lineHeight}" xmlns="http://www.w3.org/2000/svg"><text x="${width/2}" y="${fontSize+2}" font-size="${size}" font-family="Arial,sans-serif" text-anchor="middle" fill="black">${escapeXml(field.text)}</text></svg>`);
        const sprite=await sharp(svg).trim().extend({top:3,bottom:3,left:3,right:3,background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer({resolveWithObject:true});
        add({key:field.key,label:field.label,text:field.text,width:sprite.info.width,height:sprite.info.height},sprite.data,{x:.5,y:centerY/height});
    };
    for(let index=0;index<top.length;index++)await line(top[index],10+(index+.5)*lineHeight);
    for(let index=0;index<bottom.length;index++)await line(bottom[index],10+nameSpace+barsHeight+(index+.5)*lineHeight);
    const warnings=elements.filter(item=>item.key!=='barcode'&&overlapsBarcode(item,elements[0])).map(item=>`${item.label} menutupi area barcode. Geser keluar area garis barcode.`);
    return {buffer:await sharp({create:{width,height,channels:3,background:'#ffffff'}}).composite(layers).png().toBuffer(),code,name,width,height,elements,warnings};
}
