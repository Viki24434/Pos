export function findBarcode(products, value) {
    const code=String(value ?? '').trim();
    if (!code) throw new Error('Scan atau isi kode barcode.');
    const matches=[];
    for(const product of products) {
        if(String(product.code ?? product.product_code ?? '')===code) matches.push({product,variant:null});
        for(const variant of product.variants || []) if(variant.sku && String(variant.sku)===code) matches.push({product,variant});
    }
    if(!matches.length) throw new Error(`Barcode ${code} belum terdaftar.`);
    if(matches.length>1) throw new Error(`Kode ${code} dipakai lebih dari satu barang. Perbaiki kode produk atau SKU.`);
    return matches[0];
}
