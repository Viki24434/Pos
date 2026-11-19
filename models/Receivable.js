import { withDatabaseWork, withTransaction } from '../config/db.js';

const cancelled = "COALESCE(LOWER(o.status), '') IN ('batal', 'dibatalkan', 'cancelled', 'canceled')";
const money = value => Math.round(Number(value) * 100) / 100;

export async function getReceivables(filters = {}) {
    const status = filters.status || 'all';
    const due = filters.due || 'all';
    if (!['all', 'unpaid', 'partial'].includes(status) || !['all', 'overdue', 'undated'].includes(due)) throw new Error('Filter piutang tidak valid.');
    return withDatabaseWork(async db => {
        const rows = await db.all(`SELECT * FROM (
            SELECT o.*, c.phone as customer_phone,
                COALESCE(p.paid, 0) as total_paid,
                ROUND(o.total_amount - COALESCE(p.paid, 0), 2) as remaining,
                CASE WHEN DATE(o.due_date) < DATE('now', 'localtime') THEN 1 ELSE 0 END as overdue,
                CASE WHEN COALESCE(p.paid, 0) > 0 THEN 'DP' ELSE 'Belum Bayar' END as debt_status
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id AND c.store_id = o.store_id
            LEFT JOIN (SELECT order_id, SUM(amount) as paid FROM payments WHERE store_id = 1 GROUP BY order_id) p ON p.order_id = o.id
            WHERE o.store_id = 1 AND NOT (${cancelled})
        ) WHERE remaining > 0
            AND (? = '' OR invoice_number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\')
            AND (? = 'all' OR (? = 'unpaid' AND total_paid = 0) OR (? = 'partial' AND total_paid > 0))
            AND (? = 'all' OR (? = 'overdue' AND overdue = 1) OR (? = 'undated' AND DATE(due_date) IS NULL))
        ORDER BY overdue DESC, due_date IS NULL, due_date, created_at, id`, (() => {
            const search = String(filters.search || '').trim();
            const like = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
            return [search, like, like, like, status, status, status, due, due, due];
        })());
        return { rows, summary: {
            remaining: money(rows.reduce((sum, row) => sum + row.remaining, 0)),
            invoices: rows.length,
            overdue: rows.filter(row => row.overdue).length,
            overdue_amount: money(rows.filter(row => row.overdue).reduce((sum, row) => sum + row.remaining, 0)),
        } };
    });
}

export async function setDueDate(id, dueDate) {
    id = Number(id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Pesanan tidak valid.');
    if (dueDate !== '' && dueDate != null) {
        if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Tanggal jatuh tempo tidak valid.');
        const parsed = new Date(dueDate + 'T00:00:00Z');
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate) throw new Error('Tanggal jatuh tempo tidak valid.');
    }
    return withTransaction(async db => {
        const result = await db.run(`UPDATE orders AS o SET due_date = ? WHERE id = ? AND store_id = 1
            AND NOT (${cancelled}) AND ROUND(total_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = o.id AND store_id = 1), 0), 2) > 0`, [dueDate || null, id]);
        if (!result.changes) throw new Error('Piutang tidak ditemukan atau sudah lunas.');
        return result;
    });
}
