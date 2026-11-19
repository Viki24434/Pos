import { withTransaction } from '../config/db.js';

function checkedDate(value) {
    if (!value) return '';
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('Tanggal laporan tidak valid.');
    return value;
}
const money = value => Math.round(Number(value || 0) * 100) / 100;

export async function getSalesProfitReport(filter = {}) {
    const start = checkedDate(filter.start);
    const end = checkedDate(filter.end);
    if (start && end && start > end) throw new Error('Tanggal awal tidak boleh melewati tanggal akhir.');
    return withTransaction(async db => {
        const orders = await db.all(`SELECT o.*,
            COALESCE(cost.amount, 0) as recorded_cost, COALESCE(cost.missing, 1) as missing_cost_items,
            COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = o.id), 0) as total_paid
            FROM orders o LEFT JOIN (
                SELECT order_id, SUM(qty * COALESCE(purchase_price, 0)) as amount,
                    SUM(CASE WHEN purchase_price IS NULL THEN 1 ELSE 0 END) as missing
                FROM order_items GROUP BY order_id
            ) cost ON cost.order_id = o.id
            WHERE o.store_id = 1 AND (? = '' OR DATE(o.created_at, 'localtime') >= ?)
                AND (? = '' OR DATE(o.created_at, 'localtime') <= ?)
                AND LOWER(o.status) NOT IN ('batal', 'dibatalkan', 'cancelled', 'canceled')
            ORDER BY o.created_at DESC, o.id DESC`, [start, start, end, end]);
        const finance = await db.get(`SELECT
            COALESCE(SUM(cash_income + transfer_income), 0) as other_income,
            COALESCE(SUM(cash_expenditure + transfer_expenditure), 0) as expenses
            FROM finance WHERE store_id = 1 AND (? = '' OR date >= ?) AND (? = '' OR date <= ?)`, [start, start, end, end]);
        const rows = orders.map(order => {
            const net_sales = money(order.total_amount - order.tax_amount);
            return { ...order, net_sales, recorded_cost: money(order.recorded_cost),
                gross_profit: order.missing_cost_items ? null : money(net_sales - order.recorded_cost),
                remaining: Math.max(0, money(order.total_amount - order.total_paid)),
            };
        });
        const missing_orders = rows.filter(order => order.missing_cost_items > 0).length;
        const net_sales = money(rows.reduce((sum, order) => sum + order.net_sales, 0));
        const recorded_cost = money(rows.reduce((sum, order) => sum + order.recorded_cost, 0));
        const gross_profit = missing_orders ? null : money(net_sales - recorded_cost);
        return { rows, summary: {
            order_count: rows.length, net_sales, recorded_cost, missing_orders, gross_profit,
            other_income: money(finance.other_income), expenses: money(finance.expenses),
            net_profit: gross_profit == null ? null : money(gross_profit + finance.other_income - finance.expenses),
            total_paid: money(rows.reduce((sum, order) => sum + order.total_paid, 0)),
            receivables: money(rows.reduce((sum, order) => sum + order.remaining, 0)),
            discount: money(rows.reduce((sum, order) => sum + order.discount_amount, 0)),
            tax: money(rows.reduce((sum, order) => sum + order.tax_amount, 0)),
        } };
    });
}
export async function getSalesReport(start, end) {
    return (await getSalesProfitReport({ start, end })).rows;
}
export async function getProfitLossReport(start, end) {
    return (await getSalesProfitReport({ start, end })).summary;
}
