export function getSellingPrice(product, isVip = false) {
    return Number(isVip && product.vip_price != null ? product.vip_price : product.price);
}
