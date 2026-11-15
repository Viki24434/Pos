const Customer = require('../models/Customer.js');

function registerCustomerHandlers(ipcMain) {
    ipcMain.handle('get-customers', () => Customer.getCustomers());
    const mutate = operation => async (...args) => {
        try {
            await operation(...args);
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message || 'Gagal memperbarui data pelanggan.' };
        }
    };
    ipcMain.handle('create-customer', (_event, data) => mutate(Customer.addCustomer)(data));
    ipcMain.handle('update-customer', (_event, id, data) => mutate(Customer.updateCustomer)(id, data));
    ipcMain.handle('delete-customer', (_event, id) => mutate(Customer.deleteCustomer)(id));
}

module.exports = { registerCustomerHandlers };
