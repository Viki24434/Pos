import { withDatabaseWork, withTransaction } from '../config/db.js';
import { ensureBatchTables } from '../config/expiry-migration.js';

export function expiryDate(value) {
    if (value == null || value === '') return null;
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : new Date(NaN);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('Tanggal kedaluwarsa tidak valid.');
    return value;
}

export async function reconcileBatches(db, productId, variantId, target) {
    await ensureBatchTables(db);
    const batches = await db.all('SELECT * FROM inventory_batches WHERE store_id=1 AND product_id=? AND variant_id IS ? ORDER BY id', [productId,variantId]);
    const total = batches.reduce((sum,row) => sum + row.remaining_qty,0);
    let difference = target - total;
    if (difference > 0) await db.run('INSERT INTO inventory_batches(product_id,variant_id,received_qty,remaining_qty) VALUES(?,?,?,?)', [productId,variantId,difference,difference]);
    else if (difference < 0) {
        const undated = batches.filter(row => !row.expires_on);
        if (undated.reduce((sum,row)=>sum+row.remaining_qty,0) < -difference) throw new Error('Stok memiliki batch bertanggal. Kurangi stok melalui halaman Kedaluwarsa.');
        for (const batch of undated) {
            const qty = Math.min(-difference,batch.remaining_qty);
            await db.run('UPDATE inventory_batches SET remaining_qty=remaining_qty-? WHERE id=?',[qty,batch.id]);
            difference += qty;
            if (!difference) break;
        }
    }
}

export async function consumeBatches(db, productId, variantId, qty) {
    const batches = await db.all(`SELECT id,remaining_qty FROM inventory_batches WHERE store_id=1 AND product_id=? AND variant_id IS ? AND remaining_qty>0
        AND (expires_on IS NULL OR expires_on>=DATE('now','localtime')) ORDER BY expires_on IS NULL,expires_on,id`,[productId,variantId]);
    if (batches.reduce((sum,row)=>sum+row.remaining_qty,0) < qty) throw new Error('Stok layak jual tidak cukup. Periksa barang kedaluwarsa.');
    const allocations=[];
    for (const batch of batches) {
        const used=Math.min(qty,batch.remaining_qty);
        await db.run('UPDATE inventory_batches SET remaining_qty=remaining_qty-? WHERE id=?',[used,batch.id]);
        allocations.push({batch_id:batch.id,qty:used});
        qty-=used;
        if (!qty) break;
    }
    return allocations;
}

export async function getExpiryBatches(filter = {}) {
    const status=filter.status || 'soon';
    if (!['all','soon','expired','undated'].includes(status)) throw new Error('Filter kedaluwarsa tidak valid.');
    const days=Number(filter.days ?? 30);
    if (![7,14,30,60,90].includes(days)) throw new Error('Rentang peringatan tidak valid.');
    const search='%'+String(filter.search || '').trim().replace(/[\\%_]/g,'\\$&')+'%';
    return withDatabaseWork(async db=>{
        const all=await db.all(`SELECT b.*,p.name as product_name,v.name as variant_name,u.name as unit_name,
            CAST(JULIANDAY(b.expires_on)-JULIANDAY(DATE('now','localtime')) AS INTEGER) as days_left
            FROM inventory_batches b JOIN products p ON p.id=b.product_id LEFT JOIN product_variants v ON v.id=b.variant_id LEFT JOIN units u ON u.id=p.unit_id
            WHERE b.store_id=1 AND p.store_id=1 AND b.remaining_qty>0 AND
            ((b.variant_id IS NOT NULL AND v.active=1) OR (b.variant_id IS NULL AND NOT EXISTS(SELECT 1 FROM product_variants a WHERE a.product_id=p.id AND a.active=1)))
            AND (p.name LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR b.batch_code LIKE ? ESCAPE '\\')
            ORDER BY b.expires_on IS NULL,b.expires_on,b.id`,[search,search,search]);
        const rows=all.filter(row=>status==='all' || (status==='undated' && row.expires_on==null) || (status==='expired' && row.days_left!=null && row.days_left<0) || (status==='soon' && row.days_left!=null && row.days_left>=0 && row.days_left<=days));
        return {rows,summary:{expired:all.filter(row=>row.days_left!=null && row.days_left<0).length,soon:all.filter(row=>row.days_left!=null && row.days_left>=0 && row.days_left<=days).length,undated:all.filter(row=>row.expires_on==null).length}};
    });
}

export async function setBatchExpiry(data) {
    const date=expiryDate(data.expires_on);
    const qty=Number(data.qty);
    if (!Number.isSafeInteger(qty) || qty<=0) throw new Error('Jumlah batch harus berupa angka bulat lebih dari 0.');
    const code=String(data.batch_code || '').trim();
    return withTransaction(async db=>{
        const batch=await db.get('SELECT * FROM inventory_batches WHERE id=? AND store_id=1',[data.id]);
        if (!batch || qty>batch.remaining_qty) throw new Error('Jumlah batch berubah. Muat ulang data.');
        if (qty===batch.remaining_qty) await db.run('UPDATE inventory_batches SET expires_on=?,batch_code=? WHERE id=?',[date,code,batch.id]);
        else {
            await db.run('UPDATE inventory_batches SET remaining_qty=remaining_qty-?,received_qty=received_qty-? WHERE id=?',[qty,qty,batch.id]);
            await db.run('INSERT INTO inventory_batches(product_id,variant_id,receipt_item_id,batch_code,expires_on,received_qty,remaining_qty) VALUES(?,?,?,?,?,?,?)',[batch.product_id,batch.variant_id,batch.receipt_item_id,code,date,qty,qty]);
        }
        return true;
    });
}

export async function removeBatchStock(data) {
    const qty=Number(data.qty);
    const reason=String(data.reason || '').trim();
    if (!Number.isSafeInteger(qty) || qty<=0 || !reason) throw new Error('Isi jumlah dan alasan pengeluaran stok.');
    return withTransaction(async db=>{
        const batch=await db.get('SELECT * FROM inventory_batches WHERE id=? AND store_id=1',[data.id]);
        if (!batch || qty>batch.remaining_qty) throw new Error('Jumlah batch berubah. Muat ulang data.');
        if (!await db.get('SELECT id FROM users WHERE id=? AND store_id=1',[data.user_id])) throw new Error('Pengguna tidak ditemukan.');
        const table=batch.variant_id?'product_variants':'products';
        const sourceId=batch.variant_id || batch.product_id;
        if (!(await db.run(`UPDATE ${table} SET stock=stock-? WHERE id=? AND stock>=?`,[qty,sourceId,qty])).changes) throw new Error('Stok fisik tidak mencukupi.');
        if (batch.variant_id) await db.run('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id=? AND active=1) WHERE id=?',[batch.product_id,batch.product_id]);
        await db.run('UPDATE inventory_batches SET remaining_qty=remaining_qty-? WHERE id=?',[qty,batch.id]);
        await db.run('INSERT INTO batch_removals(batch_id,user_id,qty,reason) VALUES(?,?,?,?)',[batch.id,data.user_id,qty,reason]);
        return true;
    });
}
