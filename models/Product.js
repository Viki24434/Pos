import { getDbConnection, withTransaction } from '../config/db.js';
import { normalizeWholesalePrices } from '../shared/pricing.js';
import { normalizeBonusPromotion } from '../shared/promotions.js';
const STORE_ID = 1;

function nonNegative(value, label, integer = false) {
    const number = Number(value);
    if (value === '' || value == null || !Number.isFinite(number) || number < 0 || (integer && !Number.isSafeInteger(number))) {
        throw new Error(`${label} harus berupa angka ${integer ? 'bulat ' : ''}minimal 0.`);
    }
    return number;
}

async function attachVariants(db, products) {
    const variants = await db.all(`SELECT v.* FROM product_variants v
        JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND v.active = 1 ORDER BY v.id`, [STORE_ID]);
    return products.map(product => ({ ...product, code: product.product_code,
        wholesale_prices: normalizeWholesalePrices(product.wholesale_prices),
        variants: variants.filter(variant => variant.product_id === product.id).map(variant => ({ ...variant,
            wholesale_prices: normalizeWholesalePrices(variant.wholesale_prices, variant.price) })) }));
}

async function getAll() {
    const db = await getDbConnection();
    const products = await db.all(`SELECT p.*, c.name as category_name, u.name as unit_name
        FROM products p LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN units u ON p.unit_id = u.id WHERE p.store_id = ? ORDER BY p.id DESC`, [STORE_ID]);
    return attachVariants(db, products);
}

async function getById(id) {
    const db = await getDbConnection();
    const product = await db.get('SELECT * FROM products WHERE id = ? AND store_id = ?', [id, STORE_ID]);
    return product ? (await attachVariants(db, [product]))[0] : undefined;
}

async function getByCategory(category_id) {
    return (await getAll()).filter(product => product.category_id === Number(category_id) && product.stock > 0);
}

async function saveProduct(id, data) {
    return withTransaction(async db => {
        const existing = id ? await db.get('SELECT * FROM products WHERE id = ? AND store_id = ?', [id, STORE_ID]) : null;
        if (id && !existing) throw new Error('Produk tidak ditemukan.');
        const name = String(data.name || '').trim();
        const costInput = data.purchase_price === undefined ? (existing?.cost_known ? existing.purchase_price : null) : data.purchase_price;
        const costKnown = costInput != null && costInput !== '';
        const purchasePrice = costKnown ? nonNegative(costInput, 'Harga modal') : 0;
        if (!name) throw new Error('Nama produk wajib diisi.');
        let code = String(data.code ?? data.product_code ?? existing?.product_code ?? '').trim();
        if (!code) {
            do {
                code = String(Math.floor(100000 + Math.random() * 900000));
            } while (await db.get('SELECT id FROM products WHERE product_code = ? AND store_id = ?', [code, STORE_ID]));
        }
        if (await db.get('SELECT id FROM products WHERE product_code = ? AND store_id = ? AND id != ?', [code, STORE_ID, id || 0])) {
            throw new Error('Kode produk sudah digunakan.');
        }
        const previousVariants = id ? await db.all('SELECT * FROM product_variants WHERE product_id = ?', [id]) : [];
        const inputVariants = data.variants === undefined ? previousVariants.filter(v => v.active) : data.variants;
        if (!Array.isArray(inputVariants)) throw new Error('Daftar varian tidak valid.');
        const names = new Set();
        const skus = new Set();
        const ids = new Set();
        const variants = inputVariants.map(variant => {
            const variantName = String(variant.name || '').trim();
            const sku = String(variant.sku || '').trim();
            if (!variantName) throw new Error('Nama setiap varian wajib diisi.');
            if (names.has(variantName.toLowerCase())) throw new Error('Nama varian tidak boleh sama dalam satu produk.');
            if (sku && skus.has(sku.toLowerCase())) throw new Error('SKU varian tidak boleh sama dalam satu produk.');
            names.add(variantName.toLowerCase());
            if (sku) skus.add(sku.toLowerCase());
            const variantId = variant.id ? Number(variant.id) : null;
            if (variant.id && (!Number.isSafeInteger(variantId) || ids.has(variantId) || !previousVariants.some(v => v.id === variantId && v.active))) {
                throw new Error('ID varian tidak valid.');
            }
            if (variantId) ids.add(variantId);
            const vipInput = variant.vip_price === undefined ? previousVariants.find(row => row.id === variantId)?.vip_price : variant.vip_price;
            const vip_price = vipInput == null || vipInput === '' ? null : nonNegative(vipInput, 'Harga VIP varian');
            const costInput = variant.purchase_price === undefined ? previousVariants.find(row => row.id === variantId)?.purchase_price : variant.purchase_price;
            const purchase_price = costInput == null || costInput === '' ? null : nonNegative(costInput, 'Harga modal varian');
            const price = nonNegative(variant.price, 'Harga varian');
            const wholesale_prices = normalizeWholesalePrices(variant.wholesale_prices ?? previousVariants.find(row => row.id === variantId)?.wholesale_prices, price);
            const previous = previousVariants.find(row => row.id === variantId);
            const promo = normalizeBonusPromotion({ buy_qty: variant.buy_qty ?? previous?.buy_qty, free_qty: variant.free_qty ?? previous?.free_qty });
            return { ...promo, purchase_price, vip_price, wholesale_prices, id: variantId, name: variantName, sku, price, stock: nonNegative(variant.stock, 'Stok varian', true) };
        });
        const price = variants.length ? Math.min(...variants.map(v => v.price)) : nonNegative(data.price, 'Harga produk');
        const wholesalePrices = normalizeWholesalePrices(data.wholesale_prices ?? existing?.wholesale_prices, variants.length ? Infinity : price);
        const promo = normalizeBonusPromotion({ buy_qty: data.buy_qty ?? existing?.buy_qty, free_qty: data.free_qty ?? existing?.free_qty });
        const vipInput = data.vip_price === undefined ? existing?.vip_price : data.vip_price;
        const vipPrice = vipInput == null || vipInput === '' ? null : nonNegative(vipInput, 'Harga VIP');
        const stock = variants.length ? variants.reduce((sum, v) => sum + v.stock, 0) : nonNegative(data.stock ?? 0, 'Stok produk', true);
        const params = [data.category_id || null, data.unit_id || null, code, name,
            purchasePrice, price, stock, data.img || existing?.img || 'default.png'];
        let result;
        if (id) {
            result = await db.run(`UPDATE products SET category_id=?, unit_id=?, product_code=?, name=?,
                purchase_price=?, price=?, stock=?, img=? WHERE id=? AND store_id=?`, [...params, id, STORE_ID]);
        } else {
            result = await db.run(`INSERT INTO products (category_id, unit_id, product_code, name, purchase_price, price, stock, img, store_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...params, STORE_ID]);
            id = result.lastID;
        }
        // Keep removed variants for historical order references.
        await db.run('UPDATE products SET vip_price = ? WHERE id = ?', [vipPrice, id]);
        await db.run('UPDATE products SET wholesale_prices = ? WHERE id = ?', [JSON.stringify(wholesalePrices), id]);
        await db.run('UPDATE products SET buy_qty = ?, free_qty = ? WHERE id = ?', [promo.buy_qty, promo.free_qty, id]);
        await db.run('UPDATE products SET cost_known = ? WHERE id = ?', [costKnown ? 1 : 0, id]);
        await db.run('UPDATE product_variants SET active = 0 WHERE product_id = ?', [id]);
        for (const variant of variants) {
            if (variant.id) {
                await db.run('UPDATE product_variants SET name=?, sku=?, price=?, stock=?, vip_price=?, purchase_price=?, wholesale_prices=?, buy_qty=?, free_qty=?, active=1 WHERE id=? AND product_id=?',
                    [variant.name, variant.sku, variant.price, variant.stock, variant.vip_price, variant.purchase_price, JSON.stringify(variant.wholesale_prices), variant.buy_qty, variant.free_qty, variant.id, id]);
            } else {
                await db.run('INSERT INTO product_variants (product_id, name, sku, price, stock, vip_price, purchase_price, wholesale_prices, buy_qty, free_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [id, variant.name, variant.sku, variant.price, variant.stock, variant.vip_price, variant.purchase_price, JSON.stringify(variant.wholesale_prices), variant.buy_qty, variant.free_qty]);
            }
        }
        return result;
    });
}

const create = data => saveProduct(null, data);
const update = (id, data) => saveProduct(id, data);

async function deleteProduct(id) {
    return withTransaction(db => db.run('DELETE FROM products WHERE id = ? AND store_id = ?', [id, STORE_ID]));
}

async function updateStock(id, qty) {
    return withTransaction(async db => {
        if (await db.get('SELECT id FROM product_variants WHERE product_id = ? AND active = 1', [id])) {
            throw new Error('Ubah stok melalui varian produk.');
        }
        const product = await db.get('SELECT stock FROM products WHERE id = ? AND store_id = ?', [id, STORE_ID]);
        if (!product) throw new Error('Produk tidak ditemukan.');
        const stock = nonNegative(product.stock + Number(qty), 'Stok produk', true);
        return db.run('UPDATE products SET stock = ? WHERE id = ?', [stock, id]);
    });
}

export { getAll, getById, getByCategory, create, update, deleteProduct, updateStock };
