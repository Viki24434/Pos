const Batches = require('../models/Batches.js');
function registerExpiryHandlers(ipcMain) {
    ipcMain.handle('get-expiry-batches', (_event,filter)=>Batches.getExpiryBatches(filter));
    const mutation=operation=>async (_event,data)=>{
        try { return {success:true,result:await operation(data)}; }
        catch(error) { return {success:false,message:error.message}; }
    };
    ipcMain.handle('set-batch-expiry',mutation(Batches.setBatchExpiry));
    ipcMain.handle('remove-batch-stock',mutation(Batches.removeBatchStock));
}
module.exports={registerExpiryHandlers};
