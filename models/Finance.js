import { getDbConnection } from '../config/db.js';
const STORE_ID = 1;

async function updateBalance(date) {
    const db = await getDbConnection();
    const payRows = await db.all(`
        SELECT COALESCE(m.kind, 'other') as kind, SUM(p.amount) as total
        FROM payments p LEFT JOIN payment_methods m ON m.name = p.payment_method COLLATE NOCASE AND m.store_id = p.store_id
        WHERE DATE(p.created_at) = ? AND p.store_id = ?
        GROUP BY COALESCE(m.kind, 'other')
    `, [date, STORE_ID]);

    let cr = 0, tr = 0, qr = 0, other = 0;

    payRows.forEach(row => {
        if (row.kind === 'cash') cr += Number(row.total);
        else if (row.kind === 'transfer') tr += Number(row.total);
        else other += Number(row.total);
    });

    const sql = `
        INSERT INTO finance (store_id, date, cash_revenue, transfer_revenue, qris_revenue, other_revenue)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_id, date) DO UPDATE SET 
        cash_revenue = excluded.cash_revenue,
        transfer_revenue = excluded.transfer_revenue,
        qris_revenue = excluded.qris_revenue,
        other_revenue = excluded.other_revenue
    `;
                 
    await db.run(sql, [STORE_ID, date, cr, tr, qr, other]);
}

async function getSummary(startDate, endDate) {
    const db = await getDbConnection();
    const summaryQuery = `
        SELECT 
            SUM(cash_revenue + cash_income - cash_expenditure) as saldo_cash,
            SUM(transfer_revenue + transfer_income - transfer_expenditure) as saldo_tf,
            SUM(qris_revenue) as saldo_qris,
            SUM(other_revenue) as saldo_other,
            SUM(cash_revenue) as omzet_cash,
            SUM(cash_income) as pemasukan_cash,
            SUM(cash_expenditure) as pengeluaran_cash,
            SUM(transfer_revenue) as omzet_tf,
            SUM(transfer_income) as pemasukan_tf,
            SUM(transfer_expenditure) as pengeluaran_tf
        FROM finance 
        WHERE store_id = ?
    `;

    const piutangQuery = `
        SELECT COALESCE(SUM(total_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = orders.id), 0)), 0) as piutang 
        FROM orders 
        WHERE payment_status != 'Lunas' AND store_id = ?
    `;

    const tableQuery = `
        SELECT * FROM finance 
        WHERE store_id = ? AND (? = '' OR date >= ?) AND (? = '' OR date <= ?)
        ORDER BY date ASC
    `;

    const summaryRow = await db.get(summaryQuery, [STORE_ID]);
    const piutangRow = await db.get(piutangQuery, [STORE_ID]);
    const tableRows = await db.all(tableQuery, [STORE_ID, startDate || '', startDate || '', endDate || '', endDate || '']);
    const methods = await db.all(`SELECT payment_method as name, SUM(amount) as total FROM payments
        WHERE store_id = ? AND (? = '' OR DATE(created_at) >= ?) AND (? = '' OR DATE(created_at) <= ?)
        GROUP BY payment_method ORDER BY payment_method`, [STORE_ID, startDate || '', startDate || '', endDate || '', endDate || '']);

    const otherMethod = await db.get("SELECT id FROM payment_methods WHERE store_id = ? AND kind = 'other' AND active = 1 LIMIT 1", [STORE_ID]);
    return {
        hasOtherMethods: !!otherMethod || Number(summaryRow.saldo_other) !== 0 || tableRows.some(row => Number(row.other_revenue) !== 0),
        saldoKas: summaryRow.saldo_cash || 0,
        saldoTf: summaryRow.saldo_tf || 0,
        saldoQris: summaryRow.saldo_qris || 0,
        saldoOther: summaryRow.saldo_other || 0,
        kasJual: summaryRow.omzet_cash || 0,
        kasMasuk: summaryRow.pemasukan_cash || 0,
        kasKeluar: summaryRow.pengeluaran_cash || 0,
        tfJual: summaryRow.omzet_tf || 0,
        tfMasuk: summaryRow.pemasukan_tf || 0,
        tfKeluar: summaryRow.pengeluaran_tf || 0,
        totalPiutang: piutangRow.piutang || 0,
        methods,
        rekap: tableRows.map(row => ({ ...row,
            cash_in: row.cash_revenue + row.cash_income, tf_in: row.transfer_revenue + row.transfer_income,
            qris_in: row.qris_revenue, other_in: row.other_revenue,
            cash_out: row.cash_expenditure, tf_out: row.transfer_expenditure,
            saldo_cash: row.cash_revenue + row.cash_income - row.cash_expenditure,
            saldo_tf: row.transfer_revenue + row.transfer_income - row.transfer_expenditure,
            saldo_qris: row.qris_revenue, saldo_other: row.other_revenue,
        })),
        summary: {
            ...summaryRow,
            piutang: piutangRow.piutang
        },
        cashflows: tableRows
    };
}

async function storeIncome(data) {
    const db = await getDbConnection();
    const column = data.payment_method === 'Cash' ? 'cash_income' : 'transfer_income';
    const query = `
        INSERT INTO finance (store_id, date, ${column}) 
        VALUES (?, ?, ?) 
        ON CONFLICT(store_id, date) DO UPDATE SET ${column} = ${column} + ?
    `;
    const result = await db.run(query, [STORE_ID, data.date, data.amount, data.amount]);
    return result;
}

async function storeExpenditure(data) {
    const db = await getDbConnection();
    const column = data.payment_method === 'Cash' ? 'cash_expenditure' : 'transfer_expenditure';
    const query = `
        INSERT INTO finance (store_id, date, ${column}) 
        VALUES (?, ?, ?) 
        ON CONFLICT(store_id, date) DO UPDATE SET ${column} = ${column} + ?
    `;
    const result = await db.run(query, [STORE_ID, data.date, data.amount, data.amount]);
    return result;
}

export { updateBalance, getSummary, storeIncome, storeExpenditure };
