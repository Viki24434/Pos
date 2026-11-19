export function getSellingPrice(product, isVip = false, qty = 1) {
    let price = Number(isVip && product.vip_price != null ? product.vip_price : product.price);
    for (const tier of normalizeWholesalePrices(product.wholesale_prices)) {
        if (qty >= tier.min_qty) price = Math.min(price, tier.price);
    }
    return price;
}

export function normalizeWholesalePrices(value = [], regularPrice) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { throw new Error('Harga grosir tidak valid.'); }
    }
    if (!Array.isArray(value) || value.length > 20) throw new Error('Maksimal 20 tingkat harga grosir.');
    const quantities = new Set();
    const tiers = value.map(tier => {
        const min_qty = Number(tier?.min_qty);
        const price = Number(tier?.price);
        if (!Number.isSafeInteger(min_qty) || min_qty < 2 || quantities.has(min_qty)) {
            throw new Error('Minimal jumlah grosir harus unik dan minimal 2.');
        }
        if (tier?.price == null || tier.price === '' || !Number.isFinite(price) || price < 0) {
            throw new Error('Harga grosir harus berupa angka minimal 0.');
        }
        quantities.add(min_qty);
        return { min_qty, price };
    }).sort((a, b) => a.min_qty - b.min_qty);
    let previousPrice = Number(regularPrice);
    for (const tier of tiers) {
        if (tier.price > previousPrice) throw new Error('Harga grosir tidak boleh naik saat jumlah bertambah.');
        previousPrice = tier.price;
    }
    return tiers;
}
