import { getDbConnection, withTransaction } from '../config/db.js';
import { updateBalance } from './Finance.js';
import { randomUUID } from 'node:crypto';
import { requireActive } from './PaymentMethod.js';
import { getSellingPrice } from '../shared/pricing.js';
import { getBonusQuantity } from '../shared/promotions.js';
import { reconcileBatches, consumeBatches } from './Batches.js';
import { ensureBatchTables } from '../config/expiry-migration.js';
const STORE_ID = 1;

async function getAllOrders(filters = {}) {
    const db = await getDbConnection();
    if (typeof filters === 'string') filters = { start: filters, end: filters };
    filters ||= {};
    let sql = `SELECT o.*, c.name as member_name, c.is_member, c.status as customer_status,
               COALESCE((SELECT SUM(amount) FROM payments WHERE order_id = o.id), 0) as total_paid
               FROM orders o
               LEFT JOIN customers c ON o.customer_id = c.id
               WHERE o.store_id = ?`;
    let params = [STORE_ID];

    if (filters.start) {
        sql += ' AND DATE(o.created_at) >= DATE(?)';
        params.push(filters.start);
    }
    if (filters.end) {
        sql += ' AND DATE(o.created_at) <= DATE(?)';
        params.push(filters.end);
    }
    if (filters.search) {
        sql += ' AND (o.invoice_number LIKE ? OR o.customer_name LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    sql += " ORDER BY o.created_at DESC";
    const rows = await db.all(sql, params);
    return rows;
}

async function getOrderById(id) {
    const db = await getDbConnection();
    const row = await db.get("SELECT * FROM orders WHERE id = ?", [id]);
    return row;
}

async function getOrderItems(order_id) {
    const db = await getDbConnection();
    await ensureBatchTables(db);
    const rows = await db.all(`SELECT oi.*, p.name as product_name,
        (CASE WHEN oi.variant_name IS NOT NULL THEN p.name || ' - ' || oi.variant_name ELSE p.name END) || CASE WHEN oi.is_free = 1 THEN ' (Gratis)' ELSE '' END as item_name
        FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`, [order_id]);
    const allocations=await db.all(`SELECT a.order_item_id,a.qty,b.batch_code,b.expires_on FROM order_item_batches a
        JOIN inventory_batches b ON b.id=a.batch_id JOIN order_items i ON i.id=a.order_item_id
        WHERE i.order_id=? AND (b.batch_code<>'' OR b.expires_on IS NOT NULL) ORDER BY a.id`,[order_id]);
    return rows.map(row=>({...row,batches:allocations.filter(item=>item.order_item_id===row.id)}));
}

async function getOrderPayments(orderId) {
    const db = await getDbConnection();
    return db.all('SELECT id, payment_method_id, payment_method, amount, created_at FROM payments WHERE order_id = ? AND store_id = ? ORDER BY id', [orderId, STORE_ID]);
}

async function createOrder(customer_name, items, tax_amount, discount, customer_id = 0, payment = null, notes = '') {
    return withTransaction(async db => {
        if (typeof notes !== 'string') throw new Error('Catatan pesanan tidak valid.');
        notes = notes.trim();
        if (!Array.isArray(items) || !items.length) throw new Error('Keranjang masih kosong.');
        customer_id = Number(customer_id);
        let isVip = false;
        if (!Number.isSafeInteger(customer_id) || customer_id < 0) throw new Error('Pelanggan tidak valid.');
        if (customer_id > 0) {
            const customer = await db.get('SELECT name, status FROM customers WHERE id = ? AND store_id = ?', [customer_id, STORE_ID]);
            if (!customer) throw new Error('Pelanggan tidak ditemukan. Silakan pilih kembali pelanggan.');
            customer_name = customer.name;
            isVip = customer.status === 'VIP';
        }
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
            const sellingPrice = getSellingPrice(source, isVip, qty);
            if (Number(item.price) !== sellingPrice) throw new Error(`Harga ${product.name} berubah. Muat ulang produk sebelum melanjutkan.`);
            const bonusQty = getBonusQuantity(source, qty);
            if (Number(item.bonus_qty ?? 0) !== bonusQty) throw new Error(`Promo ${product.name} berubah. Muat ulang produk sebelum melanjutkan.`);
            const stockQty = qty + bonusQty;
            await reconcileBatches(db,product.id,variant?.id ?? null,source.stock);
            const allocations=await consumeBatches(db,product.id,variant?.id ?? null,qty);
            const bonusAllocations=bonusQty ? await consumeBatches(db,product.id,variant?.id ?? null,bonusQty) : [];
            // Deduct immediately inside this transaction so duplicate cart lines cannot oversell.
            const result = variant
                ? await db.run('UPDATE product_variants SET stock = stock - ? WHERE id = ? AND active = 1 AND stock >= ?', [stockQty, variant.id, stockQty])
                : await db.run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [stockQty, product.id, stockQty]);
            if (!result.changes) throw new Error(`Stok ${product.name}${variant ? ' - ' + variant.name : ''} tidak mencukupi.`);
            if (variant) await db.run(`UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0)
                FROM product_variants WHERE product_id = ? AND active = 1) WHERE id = ?`, [product.id, product.id]);
            checkedItems.push({ product_id: product.id, variant_id: variant?.id ?? null, variant_name: variant?.name ?? null,
                allocations, purchase_price: variant?.purchase_price ?? (product.cost_known ? product.purchase_price : null), variant_sku: variant?.sku ?? null, qty, price: sellingPrice, subtotal: sellingPrice * qty });
            if (bonusQty) checkedItems.push({ ...checkedItems.at(-1), allocations: bonusAllocations, qty: bonusQty, price: 0, subtotal: 0, is_free: 1 });
        }
        const invoice = `INV-${Date.now()}-${randomUUID().slice(0, 8)}`;
        let subtotal = 0;
        checkedItems.forEach(item => subtotal += item.subtotal);
        if (discount > subtotal) throw new Error('Diskon tidak boleh melebihi subtotal.');
        const total_amount = Math.round(((subtotal - discount) + tax_amount) * 100) / 100;
        const userId = payment?.user_id ?? 1;
        if (!await db.get('SELECT id FROM users WHERE id = ? AND store_id = ?', [userId, STORE_ID])) {
            throw new Error('Pengguna kasir tidak ditemukan. Silakan login ulang.');
        }

        const orderResult = await db.run(
            "INSERT INTO orders (store_id, user_id, customer_id, customer_name, invoice_number, total_amount, tax_amount, discount_amount, notes, status, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Belum Bayar')",
            [STORE_ID, userId, customer_id, customer_name, invoice, total_amount, tax_amount, discount, notes]
        );
        const order_id = orderResult.lastID;

        for (let item of checkedItems) {
            const savedItem=await db.run(`INSERT INTO order_items (order_id, product_id, variant_id, variant_name, variant_sku, qty, price, subtotal, purchase_price, is_free)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [order_id, item.product_id, item.variant_id, item.variant_name, item.variant_sku, item.qty, item.price, item.subtotal, item.purchase_price, item.is_free || 0]);
            for (const allocation of item.allocations) await db.run('INSERT INTO order_item_batches(order_item_id,batch_id,qty) VALUES(?,?,?)',[savedItem.lastID,allocation.batch_id,allocation.qty]);
        }

        const cekTable = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='order_histories'");
        if (cekTable) {
            await db.run("INSERT INTO order_histories (order_id, status, description) VALUES (?, 'Pending', 'Pesanan baru dibuat')", [order_id]);
        }

        if (payment) {
            let entries = payment.payments;
            if (entries === undefined) {
                const amount = Number(payment.amount);
                if (!Number.isFinite(amount) || amount < 0 || amount > total_amount) throw new Error('Pembayaran tidak valid.');
                entries = amount > 0 ? [{ method: payment.method, amount }] : [];
            }
            validatePaymentList(entries, true);
            for (const entry of entries) await recordPayment(db, order_id, userId, entry.method, entry.amount);
            if (total_amount === 0) await db.run("UPDATE orders SET status='Selesai', payment_status='Lunas' WHERE id=?", [order_id]);
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
    return addPayments(order_id, user_id, [{ method, amount }]);
}

function validatePaymentList(payments, allowEmpty = false) {
    if (!Array.isArray(payments) || (!allowEmpty && !payments.length) || payments.length > 20 || payments.some(entry => !entry || typeof entry !== 'object')) {
        throw new Error('Daftar pembayaran tidak valid. Maksimal 20 pembayaran sekaligus.');
    }
}

async function addPayments(orderId, userId, payments) {
    validatePaymentList(payments);
    return withTransaction(async db => {
        let result;
        for (const entry of payments) result = await recordPayment(db, orderId, userId, entry.method, entry.amount);
        return result;
    });
}

async function recordPayment(db, order_id, user_id, method, amount) {
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
        throw new Error('Nominal bayar harus lebih dari 0, maksimal dua angka desimal.');
    }
    const order = await db.get('SELECT * FROM orders WHERE id = ? AND store_id = ?', [order_id, STORE_ID]);
    if (!order) throw new Error('Pesanan tidak ditemukan.');
    if (['batal', 'dibatalkan', 'cancelled', 'canceled'].includes(String(order.status || '').toLowerCase())) throw new Error('Pesanan dibatalkan dan tidak dapat dibayar.');
    if (!await db.get('SELECT id FROM users WHERE id = ? AND store_id = ?', [user_id, STORE_ID])) {
        throw new Error('Pengguna kasir tidak ditemukan. Silakan login ulang.');
    }
    const paidBefore = await db.get('SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE order_id = ?', [order_id]);
    const remaining = Math.round((order.total_amount - paidBefore.paid) * 100);
    if (remaining <= 0) throw new Error('Pesanan sudah lunas.');
    if (Math.round(amount * 100) > remaining) throw new Error('Nominal bayar melebihi sisa tagihan.');
    const selectedMethod = await requireActive(db, method);
    await db.run(
        "INSERT INTO payments (store_id, order_id, user_id, payment_method_id, payment_method, amount) VALUES (?, ?, ?, ?, ?, ?)",
        [STORE_ID, order_id, user_id, selectedMethod.id, selectedMethod.name, amount]
    );

    const { today } = await db.get("SELECT DATE('now') as today");
    await updateBalance(today);

    const paidRow = await db.get("SELECT SUM(amount) as paid FROM payments WHERE order_id = ?", [order_id]);
    const paid = paidRow.paid || 0;
    const orderRow = await db.get("SELECT total_amount FROM orders WHERE id = ?", [order_id]);
    const total = orderRow.total_amount;

    const pS = (Math.round(paid * 100) >= Math.round(total * 100)) ? 'Lunas' : 'DP';
    await db.run("UPDATE orders SET payment_status = ?, status = CASE WHEN ? = 'Lunas' THEN 'Selesai' ELSE status END WHERE id = ?", [pS, pS, order_id]);
    return { payment_status: pS, total_paid: paid, remaining: Math.max(0, Math.round((total - paid) * 100) / 100) };
}

export { getAllOrders, getOrderById, getOrderItems, getOrderPayments, createOrder, updateStatus, addPayment, addPayments };
