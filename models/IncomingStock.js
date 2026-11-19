import { withDatabaseWork, withTransaction } from '../config/db.js';
import { randomUUID } from 'node:crypto';
import { reconcileBatches, expiryDate } from './Batches.js';

function checkedId(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} tidak valid.`);
    return number;
}
function checkedDate(value, optional = false) {
    if (optional && !value) return '';
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : new Date(NaN);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Tanggal barang masuk tidak valid.');
    return value;
}
function checkedMoney(value) {
    const number = Number(value);
    const cents = Math.round(number * 100);
    if (value == null || value === '' || !Number.isFinite(number) || number < 0 || !Number.isSafeInteger(cents) || Math.abs(number * 100 - cents) > 0.00001) throw new Error('Harga beli harus minimal 0, maksimal dua angka desimal.');
    return cents;
}

export async function getSuppliers() {
    return withDatabaseWork(db => db.all('SELECT * FROM suppliers WHERE store_id = 1 ORDER BY active DESC, name COLLATE NOCASE, id'));
}
export async function saveSupplier(data) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Nama supplier wajib diisi.');
    const phone = String(data.phone || '').trim();
    const address = String(data.address || '').trim();
    const active = data.active === undefined ? 1 : Number(data.active);
    if (![0, 1].includes(active)) throw new Error('Status supplier tidak valid.');
    return withTransaction(async db => {
        if (data.id) {
            const id = checkedId(data.id, 'Supplier');
            if (!(await db.run('UPDATE suppliers SET name=?, phone=?, address=?, active=? WHERE id=? AND store_id=1', [name, phone, address, active, id])).changes) throw new Error('Supplier tidak ditemukan.');
            return id;
        }
        return (await db.run('INSERT INTO suppliers (store_id,name,phone,address,active) VALUES (1,?,?,?,?)', [name, phone, address, active])).lastID;
    });
}

export async function createReceipt(data) {
    const supplierId = checkedId(data.supplier_id, 'Supplier');
    const userId = checkedId(data.user_id, 'Pengguna');
    const date = checkedDate(data.receipt_date);
    const reference = String(data.reference || '').trim();
    const notes = String(data.notes || '').trim();
    const updateCost = data.update_cost === undefined ? true : data.update_cost;
    if (typeof updateCost !== 'boolean') throw new Error('Pengaturan harga modal tidak valid.');
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 200) throw new Error('Isi 1 sampai 200 barang masuk.');
    const requestId = String(data.request_id || randomUUID());
    if (requestId.length > 100) throw new Error('Nomor permintaan tidak valid.');
    return withTransaction(async db => {
        const existing = await db.get('SELECT id FROM stock_receipts WHERE store_id=1 AND request_id=?', [requestId]);
        if (existing) return existing.id;
        const supplier = await db.get('SELECT * FROM suppliers WHERE id=? AND store_id=1 AND active=1', [supplierId]);
        if (!supplier) throw new Error('Pilih supplier yang aktif.');
        if (!await db.get('SELECT id FROM users WHERE id=? AND store_id=1', [userId])) throw new Error('Pengguna tidak ditemukan. Silakan login ulang.');
        if (reference && await db.get('SELECT id FROM stock_receipts WHERE store_id=1 AND supplier_id=? AND reference=? COLLATE NOCASE', [supplierId, reference])) throw new Error('Nomor nota supplier sudah dicatat.');
        const keys = new Set();
        const items = [];
        let totalCents = 0;
        for (const input of data.items) {
            const qty = checkedId(input.qty, 'Jumlah barang');
            const priceCents = checkedMoney(input.purchase_price);
            const subtotal = priceCents * qty;
            totalCents += subtotal;
            if (!Number.isSafeInteger(totalCents)) throw new Error('Total barang masuk terlalu besar.');
            const product = await db.get('SELECT p.*, u.name as unit_name FROM products p LEFT JOIN units u ON u.id=p.unit_id WHERE p.id=? AND p.store_id=1', [checkedId(input.product_id, 'Produk')]);
            if (!product) throw new Error('Produk tidak ditemukan.');
            const hasVariants = await db.get('SELECT id FROM product_variants WHERE product_id=? AND active=1', [product.id]);
            let variant;
            if (hasVariants) {
                variant = await db.get('SELECT * FROM product_variants WHERE id=? AND product_id=? AND active=1', [input.variant_id ?? null, product.id]);
                if (!variant) throw new Error(`Pilih varian yang aktif untuk ${product.name}.`);
            } else if (input.variant_id != null) throw new Error(`Varian ${product.name} tidak tersedia.`);
            const expires_on=expiryDate(input.expires_on);
            const batch_code=String(input.batch_code || '').trim();
            const key = `${product.id}:${variant?.id || 0}:${batch_code}:${expires_on || ''}`;
            if (keys.has(key)) throw new Error('Barang yang sama cukup dicatat dalam satu baris.');
            keys.add(key);
            await reconcileBatches(db,product.id,variant?.id ?? null,(variant || product).stock);
            const stock = Number((variant || product).stock) + qty;
            if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(Number(product.stock) + qty)) throw new Error('Jumlah stok terlalu besar.');
            if (variant) {
                await db.run('UPDATE product_variants SET stock=? WHERE id=?', [stock, variant.id]);
                await db.run('UPDATE products SET stock=(SELECT SUM(stock) FROM product_variants WHERE product_id=? AND active=1) WHERE id=?', [product.id, product.id]);
                if (updateCost) await db.run('UPDATE product_variants SET purchase_price=? WHERE id=?', [priceCents / 100, variant.id]);
            } else {
                await db.run('UPDATE products SET stock=? WHERE id=?', [stock, product.id]);
                if (updateCost) await db.run('UPDATE products SET purchase_price=?, cost_known=1 WHERE id=?', [priceCents / 100, product.id]);
            }
            const batch=await db.run('INSERT INTO inventory_batches(product_id,variant_id,batch_code,expires_on,received_qty,remaining_qty) VALUES(?,?,?,?,?,?)',[product.id,variant?.id ?? null,batch_code,expires_on,qty,qty]);
            items.push({ batch_id: batch.lastID, batch_code, expires_on, product_id: product.id, variant_id: variant?.id ?? null, item_name: product.name + (variant ? ' - ' + variant.name : ''), unit_name: product.unit_name || '', qty, purchase_price: priceCents / 100, subtotal: subtotal / 100 });
        }
        const result = await db.run(`INSERT INTO stock_receipts (store_id,supplier_id,user_id,number,request_id,supplier_name,reference,receipt_date,notes,update_cost,total_amount)
            VALUES (1,?,?,?,?,?,?,?,?,?,?)`, [supplierId, userId, `BM-${Date.now()}-${randomUUID().slice(0,8)}`, requestId, supplier.name, reference, date, notes, updateCost ? 1 : 0, totalCents / 100]);
        for (const item of items) {
            const savedItem=await db.run('INSERT INTO stock_receipt_items (receipt_id,product_id,variant_id,item_name,unit_name,qty,purchase_price,subtotal,batch_code,expires_on) VALUES (?,?,?,?,?,?,?,?,?,?)', [result.lastID, item.product_id, item.variant_id, item.item_name, item.unit_name, item.qty, item.purchase_price, item.subtotal,item.batch_code,item.expires_on]);
            await db.run('UPDATE inventory_batches SET receipt_item_id=? WHERE id=?',[savedItem.lastID,item.batch_id]);
        }
        return result.lastID;
    });
}

export async function getReceipts(filters = {}) {
    const start = checkedDate(filters.start, true);
    const end = checkedDate(filters.end, true);
    if (start && end && start > end) throw new Error('Tanggal awal melewati tanggal akhir.');
    const search = '%' + String(filters.search || '').trim().replace(/[\\%_]/g, '\\$&') + '%';
    return withDatabaseWork(async db => {
        const rows = await db.all(`SELECT r.*, COUNT(i.id) as item_count, COALESCE(SUM(i.qty),0) as total_qty
            FROM stock_receipts r LEFT JOIN stock_receipt_items i ON i.receipt_id=r.id
            WHERE r.store_id=1 AND (?='' OR r.receipt_date>=?) AND (?='' OR r.receipt_date<=?)
            AND (r.number LIKE ? ESCAPE '\\' OR r.supplier_name LIKE ? ESCAPE '\\' OR r.reference LIKE ? ESCAPE '\\')
            GROUP BY r.id ORDER BY r.receipt_date DESC,r.id DESC`, [start,start,end,end,search,search,search]);
        return { rows, summary: { receipts: rows.length, amount: Math.round(rows.reduce((sum,row) => sum + row.total_amount * 100,0)) / 100 } };
    });
}
export async function getReceiptDetail(id) {
    return withDatabaseWork(async db => {
        const receipt = await db.get('SELECT r.*, u.name as user_name FROM stock_receipts r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.store_id=1', [checkedId(id, 'Penerimaan')]);
        if (!receipt) throw new Error('Barang masuk tidak ditemukan.');
        return { ...receipt, items: await db.all('SELECT * FROM stock_receipt_items WHERE receipt_id=? ORDER BY id', [receipt.id]) };
    });
}
