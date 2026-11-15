import { getDbConnection, withTransaction } from '../config/db.js';
import { updateBalance } from './Finance.js';
import { randomUUID } from 'node:crypto';
const STORE_ID = 1;

async function getAllOrders(date = null) {
    const db = await getDbConnection();
    let sql = `SELECT o.*, c.name as member_name, c.is_member
               FROM orders o
               LEFT JOIN customers c ON o.customer_id = c.id
               WHERE o.store_id = ?`;
    let params = [STORE_ID];

    if (date) {
        sql += " AND DATE(o.created_at) = ?";
        params.push(date);
    }
    sql += " ORDER BY o.created_at DESC";
    const rows = await db.get(sql, params);
    return rows;
}

async function getOrderById(id) {
    const db = await getDbConnection();
    const row = await db.get("SELECT * FROM orders WHERE id = ?", [id]);
    return row;
}

async function getOrderItems(order_id) {
    const db = await getDbConnection();
    const rows = await db.all(`SELECT oi.*, p.name as product_name,
        CASE WHEN oi.variant_name IS NOT NULL THEN p.name || ' - ' || oi.variant_name ELSE p.name END as item_name
        FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`, [order_id]);
    return rows;
}

async function createOrder(customer_name, items, tax_amount, discount, customer_id = 0, payment = null) {
    return withTransaction(async db => {
        if (!Array.isArray(items) || !items.length) throw new Error('Keranjang masih kosong.');
        tax_amount = Number(tax_amount);
        discount = Number(discount);
        if (!Number.isFinite(tax_amount) || tax_amount < 0 || !Number.isFinite(discount) || discount < 0) {
            throw new Error('Pajak atau diskon tidak valid.');
        }
        const checkedItems = [];
        for (const item of items) {
            const qty = Number(item.qty);
            if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error('Jumlah item harus berupa angka bulat lebih dari 0.');
            const product = await db.get('SELECT * FROM products WHERE id = ? AND store_id = ?', [item.product_id, STORE_ID]);
            if (!product) throw new Error('Produk tidak ditemukan.');
            const hasVariants = await db.get('SELECT id FROM product_variants WHERE product_id = ? AND active = 1', [product.id]);
            let variant = null;
            if (hasVariants) {
                variant = await db.get('SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND active = 1', [item.variant_id ?? null, product.id]);
                if (!variant) throw new Error(`Pilih varian yang valid untuk ${product.name}.`);
            } else if (item.variant_id != null) {
                throw new Error(`Varian ${product.name} sudah tidak tersedia.`);
            }
            const source = variant || product;
            if (Number(item.price) !== Number(source.price)) throw new Error(`Harga ${product.name} berubah. Muat ulang produk sebelum melanjutkan.`);
            // Deduct immediately inside this transaction so duplicate cart lines cannot oversell.
            const result = variant
                ? await db.run('UPDATE product_variants SET stock = stock - ? WHERE id = ? AND active = 1 AND stock >= ?', [qty, variant.id, qty])
                : await db.run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [qty, product.id, qty]);
            if (!result.changes) throw new Error(`Stok ${product.name}${variant ? ' - ' + variant.name : ''} tidak mencukupi.`);
            if (variant) await db.run(`UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0)
                FROM product_variants WHERE product_id = ? AND active = 1) WHERE id = ?`, [product.id, product.id]);
            checkedItems.push({ product_id: product.id, variant_id: variant?.id ?? null, variant_name: variant?.name ?? null,
                variant_sku: variant?.sku ?? null, qty, price: Number(source.price), subtotal: Number(source.price) * qty });
        }
        const invoice = `INV-${Date.now()}-${randomUUID().slice(0, 8)}`;
        let subtotal = 0;
        checkedItems.forEach(item => subtotal += item.subtotal);
        if (discount > subtotal) throw new Error('Diskon tidak boleh melebihi subtotal.');
        const total_amount = (subtotal - discount) + tax_amount;

        const orderResult = await db.run(
            "INSERT INTO orders (store_id, customer_id, customer_name, invoice_number, total_amount, tax_amount, discount_amount, status, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', 'Belum Bayar')",
            [STORE_ID, customer_id, customer_name, invoice, total_amount, tax_amount, discount]
        );
        const order_id = orderResult.lastID;

        for (let item of checkedItems) {
            await db.run(`INSERT INTO order_items (order_id, product_id, variant_id, variant_name, variant_sku, qty, price, subtotal)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [order_id, item.product_id, item.variant_id, item.variant_name, item.variant_sku, item.qty, item.price, item.subtotal]);
        }

        const cekTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='order_histories'");
        if (cekTable) {
            await db.run("INSERT INTO order_histories (order_id, status, description) VALUES (?, 'Pending', 'Pesanan baru dibuat')", [order_id]);
        }

        if (payment) {
            const amount = Number(payment.amount);
            if (!Number.isFinite(amount) || amount < 0 || amount > total_amount || !['Cash', 'Transfer', 'QRIS'].includes(payment.method)) {
                throw new Error('Pembayaran tidak valid.');
            }
            if (amount > 0) await recordPayment(db, order_id, payment.user_id || 1, payment.method, amount);
            if (amount >= total_amount) await db.run("UPDATE orders SET status='Selesai', payment_status='Lunas' WHERE id=?", [order_id]);
        }

        return order_id;
    });
}

async function updateStatus(id, status) {
    const db = await getDbConnection();
    const result = await db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    return result;
}

async function addPayment(order_id, user_id, method, amount) {
    return withTransaction(db => recordPayment(db, order_id, user_id, method, amount));
}

async function recordPayment(db, order_id, user_id, method, amount) {
    await db.run(
        "INSERT INTO payments (store_id, order_id, user_id, payment_method, amount) VALUES (?, ?, ?, ?, ?)",
        [STORE_ID, order_id, user_id, method, amount]
    );

    const today = new Date().toISOString().split('T')[0];
    await updateBalance(today);

    const paidRow = await db.get("SELECT SUM(amount) as paid FROM payments WHERE order_id = ?", [order_id]);
    const paid = paidRow.paid || 0;
    const orderRow = await db.get("SELECT total_amount FROM orders WHERE id = ?", [order_id]);
    const total = orderRow.total_amount;

    const pS = (paid >= total) ? 'Lunas' : 'DP';
    await db.run("UPDATE orders SET payment_status = ? WHERE id = ?", [pS, order_id]);
}

export { getAllOrders, getOrderById, getOrderItems, createOrder, updateStatus, addPayment };
