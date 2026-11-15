import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { renderReceipt } = createRequire(import.meta.url)('../electron/receipt.cjs');
const fixture = {
 store: {name: 'Toko <A>', address: 'Alamat', phone: '0800'},
 order: {invoice_number:'INV-1',customer_name:'Budi',customer_status:'VIP',created_at:'2026-11-15',total_amount:90000,discount_amount:10000,tax_amount:0},
 items:[{item_name:'Kaos - XL',qty:2,price:50000,subtotal:100000}],
 payments:[{payment_method:'Cash',amount:30000},{payment_method:'Transfer',amount:60000}],
};
test('receipt includes variants, VIP, split payments and escaped text', () => {
 const html = renderReceipt(fixture);
 for (const value of ['Toko &lt;A&gt;', 'Kaos - XL', 'VIP', 'Cash', 'Transfer', '90.000', 'Lunas']) assert.ok(html.includes(value));
 assert.ok(!html.includes('Toko <A>'));
});
test('receipt prints outstanding balance and supports all paper sizes', () => {
 const data={...fixture,payments:[{payment_method:'Cash',amount:30000}]};
 for(const paper of ['58mm','80mm','A4']) {
  const html=renderReceipt(data,paper);
  assert.ok(html.includes('60.000'));
  assert.ok(html.includes('DP'));
 }
 assert.throws(()=>renderReceipt(data,'invalid'),/Ukuran/);
});
test('receipt uses the saved paper size without a per-order selection', () => {
 assert.ok(renderReceipt({...fixture,store:{...fixture.store,receipt_paper:'58mm'}}).includes('50mm'));
});
