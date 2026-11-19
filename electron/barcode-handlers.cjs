const Barcode=require('../models/Barcode.js');
const fs=require('node:fs/promises');

function registerBarcodeHandlers(ipcMain,{BrowserWindow,dialog}) {
    const mutate=operation=>async (event,data)=>{
        try{return {success:true,...await operation(event,data)};}
        catch(error){return {success:false,message:error.message || 'Gagal membuat barcode.'};}
    };
    ipcMain.handle('create-variant-barcode',mutate(async (_event,data)=>({code:await Barcode.createVariantCode(data)})));
    ipcMain.handle('get-barcode-settings',()=>Barcode.getBarcodeSettings());
    ipcMain.handle('save-barcode-settings',mutate(async (_event,data)=>({settings:await Barcode.saveBarcodeSettings(data)})));
    ipcMain.handle('preview-barcode-settings',mutate(async (_event,data)=>{
        const output=await Barcode.previewBarcodeSettings(data);
        return {image:'data:image/png;base64,'+output.buffer.toString('base64'),width:output.width,height:output.height,elements:output.elements,warnings:output.warnings};
    }));
    ipcMain.handle('preview-product-barcode',mutate(async (_event,data)=>{
        const settings=await Barcode.getBarcodeSettings();
        const output=await Barcode.renderBarcode(await Barcode.barcodeSource(data),settings);
        if(output.warnings.length)throw new Error(output.warnings.join(' '));
        return {image:'data:image/png;base64,'+output.buffer.toString('base64'),code:output.code,width:output.width,height:output.height,settings};
    }));
    ipcMain.handle('save-product-barcode',mutate(async (event,data)=>{
        const source=await Barcode.barcodeSource(data);
        if(data.expected_code && data.expected_code!==source.code)throw new Error('Kode barang berubah. Buat ulang pratinjau.');
        const settings=await Barcode.getBarcodeSettings();
        if(data.expected_settings && JSON.stringify(data.expected_settings)!==JSON.stringify(settings))throw new Error('Pengaturan barcode berubah. Muat ulang pratinjau.');
        const output=await Barcode.renderBarcode(source,settings);
        if(output.warnings.length)throw new Error(output.warnings.join(' '));
        const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Simpan Gambar Barcode',defaultPath:`barcode-${output.code.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`,filters:[{name:'Gambar PNG',extensions:['png']}],properties:['showOverwriteConfirmation']});
        if(result.canceled || !result.filePath)return {canceled:true};
        const filename=result.filePath;
        await fs.writeFile(filename,output.buffer);
        return {filename,width:output.width,height:output.height};
    }));
}
module.exports={registerBarcodeHandlers};
