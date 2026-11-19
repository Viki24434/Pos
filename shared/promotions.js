export function normalizeBonusPromotion(value = {}) {
    const buy_qty = Number(value.buy_qty ?? 0);
    const free_qty = Number(value.free_qty ?? 0);
    if (buy_qty === 0 && free_qty === 0) return { buy_qty: 0, free_qty: 0 };
    if (!Number.isSafeInteger(buy_qty) || buy_qty < 1 || !Number.isSafeInteger(free_qty) || free_qty < 1) {
        throw new Error('Jumlah beli dan gratis harus berupa angka bulat minimal 1.');
    }
    return { buy_qty, free_qty };
}

export function getBonusQuantity(product, purchasedQty) {
    const { buy_qty, free_qty } = normalizeBonusPromotion(product);
    const bonus = buy_qty ? Math.floor(purchasedQty / buy_qty) * free_qty : 0;
    if (!Number.isSafeInteger(bonus) || !Number.isSafeInteger(purchasedQty + bonus)) throw new Error('Jumlah promo terlalu besar.');
    return bonus;
}
