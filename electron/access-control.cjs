const Users = require('../models/UserAccess.js');
const { can } = require('../shared/permissions.js');

const CHANNELS = {};
function allow(permission, channels) { for (const channel of channels.split(' ')) CHANNELS[channel] = permission; }
allow(null, 'check-activation activate-device get-ip-address');
allow([], 'get-settings');
allow(['sales.create','products.manage','stock.manage'], 'get-categories get-units get-products get-product');
allow(['sales.create','customers.manage'], 'get-customers');
allow(['sales.pay','settings.manage'], 'get-payment-methods');
allow(['sales.view','receivables.manage','settings.manage'], 'get-print-settings get-printers');
allow(['sales.view', 'receivables.manage'], 'get-orders get-order-detail get-order-payments get-print-data preview-receipt print-receipt');
allow('sales.create', 'create-order');
allow('sales.pay', 'process-payment');
allow('receivables.manage', 'get-receivables set-receivable-due-date');
allow('customers.manage', 'create-customer update-customer delete-customer');
allow('products.manage', 'create-product update-product delete-product upload-product-image create-category update-category delete-category create-unit update-unit delete-unit');
allow('stock.manage', 'get-suppliers save-supplier get-stock-receipts get-stock-receipt-detail create-stock-receipt');
allow(['stock.manage','products.manage'], 'get-expiry-batches set-batch-expiry remove-batch-stock');
allow('finance.view', 'get-finance-summary');
allow('finance.manage', 'store-income store-expenditure');
allow('reports.view', 'get-dashboard-data get-sales-report get-sales-profit-report get-product-report get-customer-report get-payment-method-report get-receivables-report get-income-expenditure-report get-profit-loss-report save-order-costs');
allow('settings.manage', 'save-settings save-print-settings create-payment-method set-payment-method-active');
allow('backup.manage', 'backup-database restore-database');
allow('users.manage', 'get-users save-user');

const withoutCosts = value => {
    if (Array.isArray(value)) return value.map(withoutCosts);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['purchase_price','cost_known'].includes(key)).map(([key,item]) => [key, withoutCosts(item)]));
};
function createAccessControl(rawIpc) {
    const sessions = new Map();
    const resolve = async event => {
        const id = sessions.get(event.sender.id);
        return id ? Users.getSessionUser(id) : null;
    };
    rawIpc.handle('auth-login', async (event, credentials) => {
        sessions.delete(event.sender.id);
        try {
            const user = await Users.authenticate(credentials);
            if (!user) return { success: false, message: 'Username atau password salah, atau akun nonaktif.' };
            sessions.set(event.sender.id, user.id);
            event.sender.once?.('destroyed', () => sessions.delete(event.sender.id));
            return { success: true, user };
        } catch { return { success: false, message: 'Gagal login. Silakan coba lagi.' }; }
    });
    rawIpc.handle('check-auth', event => resolve(event));
    rawIpc.handle('auth-logout', event => { sessions.delete(event.sender.id); return true; });
    const ipcMain = { handle(channel, handler) {
        rawIpc.handle(channel, async (event, ...args) => {
            if (!(channel in CHANNELS)) throw new Error('Akses tidak diizinkan.');
            const permission = CHANNELS[channel];
            if (permission === null) return handler(event, ...args);
            const user = await resolve(event);
            if (!user) throw new Error('Sesi berakhir. Silakan login ulang.');
            const needed = Array.isArray(permission) ? permission : [permission];
            if (needed.length && !needed.some(key => can(user, key))) throw new Error('Anda tidak memiliki hak akses untuk tindakan ini.');
            if (channel === 'create-order') {
                if (Number(args[0]?.discount) > 0 && !can(user, 'sales.discount')) throw new Error('Anda tidak memiliki hak akses memberi diskon.');
                if ((Number(args[0]?.amountPaid) > 0 || args[0]?.payments?.length) && !can(user, 'sales.pay')) throw new Error('Anda tidak memiliki hak akses menerima pembayaran.');
                args[0] = { ...args[0], userId: user.id };
            }
            if (channel === 'process-payment') args[0] = { ...args[0], userId: user.id };
            if (channel === 'remove-batch-stock') args[0] = { ...args[0], user_id: user.id };
            if (channel === 'create-stock-receipt') args[0] = { ...args[0], user_id: user.id };
            if (channel === 'create-stock-receipt' && !can(user, 'cost.view')) throw new Error('Harga modal memerlukan hak akses khusus.');
            if (channel === 'save-order-costs' && !can(user, 'cost.view')) throw new Error('Harga modal memerlukan hak akses khusus.');
            if (['create-product','update-product'].includes(channel) && !can(user, 'cost.view')) {
                const position = channel === 'update-product' ? 1 : 0;
                args[position] = withoutCosts(args[position]);
            }
            const result = await handler(event, ...args);
            if (channel === 'restore-database' && result?.success) sessions.clear();
            if (!can(user, 'cost.view') && ['get-products','get-product','get-order-detail','get-print-data','get-stock-receipt-detail'].includes(channel)) return withoutCosts(result);
            return result;
        });
    } };
    ipcMain.handle('get-users', () => Users.getUsers());
    ipcMain.handle('save-user', async (_event, data) => {
        try {
            const result = await Users.saveUser(data);
            if (data.password) for (const [senderId,userId] of sessions) { if (userId === result) sessions.delete(senderId); }
            return { success: true, result };
        }
        catch (error) { return { success: false, message: error.message }; }
    });
    return { ipcMain };
}
module.exports = { createAccessControl };
