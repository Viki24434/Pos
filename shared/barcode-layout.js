export function labelFields(source,settings){
    const top=[
        ['store','Nama toko',source.store_name,settings.show_store],
        ['name','Nama produk',source.product_name || source.name,settings.show_name],
        ['variant','Nama varian',source.variant_name,settings.show_variant],
        ['category','Kategori',source.category_name,settings.show_category],
        ['unit','Satuan',source.unit_name,settings.show_unit],
    ];
    const price=source.price==null?'':`${source.has_variants?'Mulai ':''}Rp ${Number(source.price).toLocaleString('id-ID',{maximumFractionDigits:2})}`;
    const bottom=[['code','Kode barcode',source.code,settings.show_code],['price','Harga jual',price,settings.show_price],['custom_text','Teks tambahan',settings.custom_text,!!settings.custom_text]];
    const map=rows=>rows.filter(row=>row[3]).map(([key,label,text])=>({key,label,text:String(text ?? '')}));
    return {top:map(top),bottom:map(bottom)};
}
export function placeLabelElement(element,point,canvas){
    const left=Math.max(0,Math.min(canvas.width-element.width,Math.round(point.x*canvas.width-element.width/2)));
    const top=Math.max(0,Math.min(canvas.height-element.height,Math.round(point.y*canvas.height-element.height/2)));
    return {x:left+element.width/2,y:top+element.height/2};
}
export function overlapsBarcode(element,barcode){
    return Math.abs(element.x-barcode.x)*2<element.width+barcode.width && Math.abs(element.y-barcode.y)*2<element.height+barcode.height;
}
