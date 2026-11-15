const Order = require('../models/Order.js');
const PaymentMethod = require('../models/PaymentMethod.js');

function registerPaymentHandlers(ipcMain) {
    const mutate = operation => async (...args) => {
        try { return { success: true, result: await operation(...args) }; }
        catch (error) { return { success: false, message: error.message || 'Gagal memproses pembayaran.' }; }
    };
    ipcMain.handle('get-payment-methods', (_event, options) => PaymentMethod.getAll(options));
    ipcMain.handle('create-payment-method', mutate((_event, data) => PaymentMethod.create(data)));
    ipcMain.handle('set-payment-method-active', mutate((_event, id, active) => PaymentMethod.setActive(id, active)));
    ipcMain.handle('get-orders', (_event, filters) => Order.getAllOrders(filters));
    ipcMain.handle('get-order-payments', (_event, id) => Order.getOrderPayments(id));
    ipcMain.handle('create-order', async (_event, data) => {
        try {
            const items = data.items.map(item => ({ ...item, product_id: item.product_id ?? item.id }));
            return await Order.createOrder(data.customerName || 'Umum', items, 0, data.discount ?? 0, data.customerId ?? 0,
                { amount: data.amountPaid ?? 0, method: data.paymentMethod || 'Cash', payments: data.payments, user_id: data.userId ?? 1 });
        } catch (error) { return { success: false, message: error.message || 'Gagal membuat pesanan.' }; }
    });
    ipcMain.handle('process-payment', mutate((_event, data) => data.payments !== undefined
        ? Order.addPayments(data.id, data.userId ?? 1, data.payments)
        : Order.addPayment(data.id, data.userId ?? 1, data.paymentMethod, data.total)));
}

module.exports = { registerPaymentHandlers };
