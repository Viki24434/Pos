import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import process from 'node:process';
import sharp from 'sharp';
import {MultiFormatReader,RGBLuminanceSource,HybridBinarizer,BinaryBitmap} from '@zxing/library';
import {findBarcode} from '../shared/barcodes.js';
import {migrateBarcodeSettings} from '../config/barcode-migration.js';
import {DEFAULT_BARCODE_SETTINGS,normalizeBarcodeSettings} from '../shared/barcode-settings.js';

process.env.APP_JS_DB_PATH=':memory:';
const {getDbConnection}=await import('../config/db.js');
const Product=await import('../models/Product.js');
const Barcode=await import('../models/Barcode.js');

test('barcode lookup preserves leading zeroes, selects exact variants and refuses ambiguous codes',()=>{
    const products=[{id:1,code:'00123',variants:[]},{id:2,code:'PARENT',variants:[{id:10,sku:'RED-XL'},{id:11,sku:''}]}];
    assert.equal(findBarcode(products,'00123\r\n').product.id,1);
    assert.equal(findBarcode(products,'RED-XL').variant.id,10);
    assert.equal(findBarcode(products,'PARENT').variant,null);
    assert.throws(()=>findBarcode(products,'123'),/belum terdaftar/);
    assert.throws(()=>findBarcode(products,''),/isi kode/);
    assert.throws(()=>findBarcode([...products,{id:3,code:'RED-XL'}],'RED-XL'),/lebih dari satu/);
});

test('custom PNG sizes decode independently and retain white quiet zones',async()=>{
    for(const [code,width,height,show_name,show_code] of [['0012345678905',400,160,true,true],['V-AB12CD34EF56',800,300,true,true],['123456',240,120,false,false],['A<&"B',500,180,true,false]]){
        const image=await Barcode.renderBarcode({code,name:'Produk <A> & B'},{width,height,show_name,show_code});
        const metadata=await sharp(image.buffer).metadata();
        assert.equal(metadata.width,width);assert.equal(metadata.height,height);assert.equal(metadata.format,'png');
        const {data,info}=await sharp(image.buffer).greyscale().raw().toBuffer({resolveWithObject:true});
        const bitmap=new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data),info.width,info.height)));
        assert.equal(new MultiFormatReader().decode(bitmap,new Map()).getText(),code);
        for(let x=0;x<10;x++){assert.equal(data[Math.floor(height/2)*width+x],255);assert.equal(data[Math.floor(height/2)*width+(width-1-x)],255);}
    }
    for(const settings of [{width:1},{height:2000},{width:250.5},{font_size:1},{width:120},{height:80,font_size:28}])await assert.rejects(Barcode.renderBarcode({code:'VERYLONG-BARCODE-0123456789',name:'Test'},settings));
    await assert.rejects(Barcode.renderBarcode({code:'kode-中文'}),/ASCII/);
});

test('label fields separate product and variant, include sale price and omit disabled information',()=>{
    const source={code:'000123',name:'Gabungan',product_name:'Beras',variant_name:'5 kg',store_name:'Toko A',price:65000,category_name:'Sembako',unit_name:'karung'};
    const settings=normalizeBarcodeSettings({show_store:true,show_price:true,show_category:true,show_unit:true,custom_text:'Terima kasih'});
    assert.deepEqual(Barcode.barcodeTextLines(source,settings),{top:['Toko A','Beras','5 kg','Sembako · karung'],bottom:['000123','Rp 65.000','Terima kasih']});
    assert.deepEqual(Barcode.barcodeTextLines(source,normalizeBarcodeSettings({show_name:false,show_variant:false,show_code:false})),{top:[],bottom:[]});
    assert.equal(Barcode.barcodeTextLines({...source,has_variants:true},settings).bottom[1],'Mulai Rp 65.000');
    assert.throws(()=>normalizeBarcodeSettings({show_variant:'yes'}));
    assert.throws(()=>normalizeBarcodeSettings({custom_text:'a'.repeat(121)}));
});

test('drag positions affect rendered pixels, stay in bounds, and preserve scan readability',async()=>{
    const source={code:'0012345678905',name:'Produk A',product_name:'Produk A',variant_name:'Besar'};
    const settings=normalizeBarcodeSettings({width:640,height:240,positions:{name:{x:.2,y:.18},variant:{x:.8,y:.09},code:{x:.3,y:.95},barcode:{x:.49,y:.54}}});
    const result=await Barcode.renderBarcode(source,settings);
    assert.equal(result.warnings.length,0);
    assert.ok(result.elements.find(row=>row.key==='name').x<640*.3);
    const clipped=await Barcode.renderBarcode(source,{...settings,positions:{name:{x:0,y:0},variant:{x:1,y:0}}});
    for(const element of clipped.elements){assert.ok(element.x-element.width/2>=0);assert.ok(element.y-element.height/2>=0);assert.ok(element.x+element.width/2<=640);assert.ok(element.y+element.height/2<=240);}
    const {data,info}=await sharp(result.buffer).greyscale().raw().toBuffer({resolveWithObject:true});
    assert.equal(new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data),info.width,info.height))),new Map()).getText(),source.code);
    const overlap=await Barcode.renderBarcode(source,{...settings,positions:{name:{x:.5,y:.5}}});
    assert.ok(overlap.warnings.some(message=>message.includes('Nama produk')));
    assert.throws(()=>normalizeBarcodeSettings({positions:{name:{x:-1,y:.2}}}),/Posisi/);
    assert.throws(()=>normalizeBarcodeSettings({positions:{unknown:{x:.2,y:.2}}}),/Posisi/);
});

test('barcode sources and generated variant SKUs use stored product identities without changing stock',async t=>{
    const db=await getDbConnection();t.after(()=>db.close());
    const schema=await fs.readFile(new URL('../database.sql',import.meta.url),'utf8');
    await db.exec(schema.replace("  barcode_settings TEXT NOT NULL DEFAULT '{}',",''));
    await migrateBarcodeSettings(db);await migrateBarcodeSettings(db);
    assert.deepEqual(await Barcode.getBarcodeSettings(),DEFAULT_BARCODE_SETTINGS);
    const settings={...DEFAULT_BARCODE_SETTINGS,width:640,height:300,show_store:true,show_price:true,show_category:true,show_unit:true,custom_text:'Terima kasih'};
    await Barcode.saveBarcodeSettings(settings);
    assert.deepEqual(await Barcode.getBarcodeSettings(),settings);
    const positioned={...settings,positions:{name:{x:.25,y:.14},variant:{x:.75,y:.21},code:{x:.3,y:.78}}};
    await Barcode.saveBarcodeSettings(positioned);
    assert.deepEqual((await Barcode.getBarcodeSettings()).positions,positioned.positions);
    await assert.rejects(Barcode.saveBarcodeSettings({...settings,positions:{name:{x:.5,y:.55}}}),/menutupi/);
    assert.deepEqual((await Barcode.getBarcodeSettings()).positions,positioned.positions);
    await Barcode.saveBarcodeSettings(settings);
    await assert.rejects(Barcode.saveBarcodeSettings({...settings,height:80}),/Tinggi/);
    assert.deepEqual(await Barcode.getBarcodeSettings(),settings);
    const product=await Product.create({code:'000123',name:'Beras',price:10000,stock:5});
    assert.equal((await Barcode.barcodeSource({product_id:product.lastID})).code,'000123');
    const created=await Product.create({code:'SNACK',name:'Snack',variants:[{name:'Pedas',price:10000,stock:2},{name:'Manis',sku:'SN-MANIS',price:10000,stock:3}]});
    const [pedas,manis]=(await Product.getById(created.lastID)).variants;
    await assert.rejects(Barcode.barcodeSource({product_id:created.lastID,variant_id:pedas.id}),/belum memiliki SKU/);
    const code=await Barcode.createVariantCode({product_id:created.lastID,variant_id:pedas.id});
    assert.match(code,/^V-[A-Z0-9]{12}$/);
    assert.equal(await Barcode.createVariantCode({product_id:created.lastID,variant_id:pedas.id}),code);
    assert.equal((await Barcode.barcodeSource({product_id:created.lastID,variant_id:pedas.id})).code,code);
    const variantSource=await Barcode.barcodeSource({product_id:created.lastID,variant_id:pedas.id});
    assert.equal(variantSource.product_name,'Snack');assert.equal(variantSource.variant_name,'Pedas');assert.equal(variantSource.price,10000);
    const label=await Barcode.renderBarcode(variantSource,await Barcode.getBarcodeSettings());
    assert.equal((await sharp(label.buffer).metadata()).height,300);
    assert.equal((await Product.getById(created.lastID)).stock,5);
    assert.equal(findBarcode(await Product.getAll(),code).variant.id,pedas.id);
    await assert.rejects(Barcode.barcodeSource({product_id:product.lastID,variant_id:pedas.id}),/tidak ditemukan/);
    const duplicate=await Product.create({code:'DUP',name:'Duplikat',variants:[{name:'A',sku:'SN-MANIS',price:10000,stock:1}]});
    await assert.rejects(Barcode.barcodeSource({product_id:created.lastID,variant_id:manis.id}),/lebih dari satu/);
    assert.ok(duplicate.lastID>0);
});
