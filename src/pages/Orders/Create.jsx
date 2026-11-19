import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button/Button';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import StatusBadge from '../../components/StatusBadge/StatusBadge';
import Alert from '../../components/Alert/Alert';
import Table from '../../components/Table/Table';
import IconButton from '../../components/IconButton/IconButton';
import Modal from '../../components/Modal/Modal';
import PaymentForm from '../../components/PaymentForm/PaymentForm';
import { useAuth } from '../../context/AuthContext';
import { formatRp } from '../../utils/format';
import './Create.css';
import { getSellingPrice } from '../../../shared/pricing';

const ITEMS_PER_PAGE = 12; // Jumlah produk per halaman

export default function CreateOrder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  
  // Filter & Pagination State
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [customerError, setCustomerError] = useState('');
  const selectedCustomer = customers.find(customer => String(customer.id) === customerId);
  const isVip = selectedCustomer?.status === 'VIP';
  const pricedCart = cart.map(item => {
    const product = products.find(row => row.id === item.product_id);
    const source = item.variant_id ? product?.variants?.find(row => row.id === item.variant_id) : product;
    const price = source ? getSellingPrice(source, isVip, item.qty) : item.price;
    return { ...item, price, subtotal: price * item.qty };
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await window.api.getCustomers();
        if (!Array.isArray(rows)) throw new Error('Invalid customers');
        if (active) setCustomers(rows);
      } catch {
        if (active) setCustomerError('Gagal memuat pelanggan tersimpan. Muat ulang aplikasi untuk memilih pelanggan VIP.');
      }
    })();
    return () => { active = false; };
  }, []);
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState('');
  const [variantProduct, setVariantProduct] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [resProd, resCat] = await Promise.all([
          window.api.getProducts(),
          window.api.getCategories()
        ]);
        setProducts(resProd || []);
        setCategories(resCat || []);
      } catch {
        setError('Gagal memuat produk dan kategori.');
      }
    })();
  }, []);

  const getImageUrl = (imgName) => {
    return imgName && imgName !== 'default.png'
      ? `pos-file://${imgName}`
      : 'https://placehold.co/100x100/e2e8f0/64748b?text=No+Image';
  };

  const addToCart = (product, variant = null) => {
    if (product.variants?.length && !variant) {
      setVariantProduct(product);
      return;
    }
    const stock = variant ? variant.stock : product.stock;
    const price = getSellingPrice(variant || product, isVip);
    if (stock <= 0) return;
    const key = `${product.id}:${variant?.id || 'base'}`;

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.key === key);
      if (existing) {
        if (existing.qty >= stock) {
          alert(`Stok tidak mencukupi! Sisa stok hanya ${stock}.`);
          return prevCart;
        }
        return prevCart.map((item) =>
          item.key === key
            ? { ...item, qty: item.qty + 1, subtotal: (item.qty + 1) * item.price }
            : item
        );
      }
      return [...prevCart, { key, product_id: product.id, variant_id: variant?.id ?? null,
        name: variant ? `${product.name} - ${variant.name}` : product.name, price, qty: 1, subtotal: price }];
    });
    setVariantProduct(null);
  };

  const updateQty = (key, delta) => {
    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.key === key) {
            const productRef = products.find(p => p.id === item.product_id);
            const stock = item.variant_id ? productRef?.variants?.find(v => v.id === item.variant_id)?.stock : productRef?.stock;
            const newQty = item.qty + delta;
            
            if (newQty > (stock ?? 0)) {
              alert(`Stok tidak mencukupi! Sisa stok hanya ${stock ?? 0}.`);
              return item;
            }
            
            return newQty > 0 ? { ...item, qty: newQty, subtotal: newQty * item.price } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (key) => {
    setCart((prevCart) => prevCart.filter((item) => item.key !== key));
  };

  const subtotal = Math.round(pricedCart.reduce((acc, item) => acc + item.subtotal, 0) * 100) / 100;
  const discValue = parseFloat(discount) || 0;
  const grandTotal = Math.max(0, Math.round((subtotal - discValue) * 100) / 100);

  const validateCart = () => {
    if (processing) return false;
    if (cart.length === 0) {
      alert('Keranjang masih kosong!');
      return false;
    }
    if (!Number.isFinite(Number(discount)) || Number(discount) < 0 || Number(discount) > subtotal) {
      setError('Diskon harus antara 0 dan subtotal.');
      return false;
    }
    return true;
  };

  const handleProcessOrder = () => {
    if (!validateCart()) return;
    setPaymentError('');
    setPaymentOpen(true);
  };

  const submitOrder = async ({ amount, method, payments }) => {
    if (processing) return;
    setProcessing(true);
    setPaymentError('');
    setError('');
    try {
      const payload = {
        customerName: selectedCustomer?.name || customerName.trim() || 'Umum',
        customerId: customerId ? Number(customerId) : 0,
        notes,
        items: pricedCart,
        discount: discValue,
        grandTotal,
        amountPaid: amount,
        paymentMethod: method,
        payments,
        userId: user?.id,
      };

      const orderId = await window.api.createOrder(payload);
      if (typeof orderId === 'number' && orderId > 0) {
        alert(amount > 0 ? 'Pesanan dan pembayaran berhasil disimpan.' : 'Pesanan disimpan. Klik Bayar pada daftar pesanan untuk mencatat pembayaran.');
        navigate('/orders');
      } else {
        if (paymentOpen) setPaymentError(orderId?.message || 'Gagal memproses pesanan.');
        else setError(orderId?.message || 'Gagal menyimpan pesanan.');
      }
    } catch {
      if (paymentOpen) setPaymentError('Terjadi kesalahan sistem saat menyimpan pembayaran.');
      else setError('Gagal menyimpan pesanan.');
    } finally {
      setProcessing(false);
    }
  };

  // Logika Filter
  const filteredProducts = products.filter((p) => {
    const matchSearch = p.name?.toLowerCase().includes(search.toLowerCase()) || p.code?.toLowerCase().includes(search.toLowerCase()) ||
      p.variants?.some(variant => `${variant.name} ${variant.sku || ''}`.toLowerCase().includes(search.toLowerCase()));
    
    // PERBAIKAN: Ubah p.category_id menjadi string agar cocok dengan selectedCategory
    const matchCategory = selectedCategory ? String(p.category_id) === selectedCategory : true;
    
    return matchSearch && matchCategory;
  });

  // Logika Pagination
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentProducts = filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const cartColumns = [
    { key: 'name', label: 'Item', render: item => <div>{item.name}<small className="cart-unit-price">{formatRp(item.price)} / satuan</small></div> },
    {
      key: 'qty',
      label: 'Qty',
      headerStyle: { width: 70, textAlign: 'center' },
      cellStyle: { textAlign: 'center' },
      render: (item) => (
        <div className="qty-stepper">
          <button type="button" onClick={() => updateQty(item.key, -1)}>-</button>
          <span>{item.qty}</span>
          <button type="button" onClick={() => updateQty(item.key, 1)}>+</button>
        </div>
      ),
    },
    {
      key: 'subtotal',
      label: 'Sub',
      headerStyle: { textAlign: 'right' },
      cellStyle: { textAlign: 'right' },
      render: (item) => formatRp(item.subtotal),
    },
    {
      key: 'remove',
      label: '',
      headerStyle: { width: 30 },
      cellStyle: { textAlign: 'center' },
      render: (item) => <IconButton icon="fas fa-trash" variant="danger" onClick={() => removeFromCart(item.key)} title="Hapus" />,
    },
  ];

  return (
    <div className="create-order-page">
      <Alert>{error}</Alert>

      <div className="create-order-header">
        <h2><i className="fas fa-desktop"></i> Kasir / Transaksi Baru</h2>
        <Button variant="secondary" icon="fas fa-arrow-left" onClick={() => navigate('/orders')}>
          Kembali
        </Button>
      </div>

      <div className="create-order-layout">
        <div className="card product-panel">
          
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
            <select 
              className="input-field" 
              style={{ flex: 1, margin: 0 }}
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setCurrentPage(1); }}
            >
              <option value="">Semua Kategori</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            
            <input
              type="text"
              className="input-field"
              placeholder="Cari nama atau scan barcode..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              style={{ flex: 2, margin: 0 }}
            />
          </div>

          <div className="product-grid">
            {currentProducts.length === 0 ? (
              <p style={{ textAlign: 'center', gridColumn: '1 / -1', padding: '20px', color: 'var(--muted)' }}>Produk tidak ditemukan.</p>
            ) : (
              currentProducts.map((p) => {
                const isOutOfStock = p.stock <= 0;
                
                return (
                  <div 
                    key={p.id} 
                    className="product-tile" 
                    onClick={() => !isOutOfStock && addToCart(p)}
                    style={{ 
                      padding: '8px', 
                      position: 'relative',
                      opacity: isOutOfStock ? 0.6 : 1,
                      cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                      border: isOutOfStock ? '1px solid #fee2e2' : ''
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: isOutOfStock ? '#ef4444' : '#10b981',
                      color: 'white',
                      fontSize: '10px',
                      fontWeight: '800',
                      padding: '3px 6px',
                      borderRadius: '4px',
                      zIndex: 2,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                      Stok: {p.stock}
                    </span>

                    <img 
                      src={getImageUrl(p.img)} 
                      alt={p.name} 
                      style={{ width: '100%', height: '80px', objectFit: 'contain', borderRadius: '6px', marginBottom: '6px', background: '#f8fafc', border: '1px solid #e2e8f0' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
                      <b style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</b>
                      <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '13px' }}>{p.variants?.length ? 'Mulai ' : ''}{formatRp(p.variants?.length ? Math.min(...p.variants.map(variant => getSellingPrice(variant, isVip))) : getSellingPrice(p, isVip))}</span>
                      {!!p.variants?.length && <small className="product-variant-count">Pilih {p.variants.length} varian</small>}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginTop: '20px', padding: '10px 0', borderTop: '1px solid var(--border-color)' }}>
              <Button 
                variant="secondary" 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                disabled={currentPage === 1}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                <i className="fas fa-chevron-left" style={{ marginRight: '5px' }}></i> Prev
              </Button>
              <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--dark)' }}>
                Hal {currentPage} dari {totalPages}
              </span>
              <Button 
                variant="secondary" 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                disabled={currentPage === totalPages}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Next <i className="fas fa-chevron-right" style={{ marginLeft: '5px' }}></i>
              </Button>
            </div>
          )}
        </div>

        <div className="card cart-panel">
          <h3>Keranjang</h3>

          <Alert>{customerError}</Alert>
          <Select id="order-customer" label="Pelanggan" value={customerId} onChange={event => setCustomerId(event.target.value)}>
            <option value="">Pelanggan Umum / Nama Manual</option>
            {customers.map(customer => <option key={customer.id} value={customer.id}>
              {customer.name} — {customer.status || (customer.is_member ? 'Member' : 'Umum')}{customer.phone ? ` — ${customer.phone}` : ''}
            </option>)}
          </Select>
          {selectedCustomer ? <div style={{ marginBottom: 16 }}>
            <StatusBadge status={selectedCustomer.status || (selectedCustomer.is_member ? 'Member' : 'Umum')} />
            {selectedCustomer.phone && <span style={{ marginLeft: 8 }}>{selectedCustomer.phone}</span>}
          </div> : <Input
            placeholder="Nama Pelanggan (Kosongkan jika Umum)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />}

          <div className="cart-table-wrapper">
            <Table columns={cartColumns} data={pricedCart} keyField="key" emptyText="Keranjang kosong" />
          </div>

          <details className="order-notes">
            <summary>{notes.trim() ? 'Catatan pesanan' : 'Tambah catatan'} <span>Opsional</span></summary>
            <label className="order-notes-label" htmlFor="order-notes">Catatan pesanan</label>
            <textarea id="order-notes" className="input-field" rows={2} placeholder="Contoh: pisahkan kemasan atau kirim sore." value={notes} onChange={event => setNotes(event.target.value)} />
          </details>

          <div className="cart-summary">
            <div className="summary-row">
              <span>Subtotal</span><strong>{formatRp(subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Diskon (Rp)</span>
              <input
                type="number"
                className="input-field discount-input"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                min="0"
              />
            </div>
            <div className="summary-row summary-total">
              <strong>TOTAL</strong><strong>{formatRp(grandTotal)}</strong>
            </div>
          </div>

          <Button variant="success" fullWidth icon="fas fa-check-circle" disabled={processing} onClick={handleProcessOrder} className="process-order-btn">
            {processing ? 'Menyimpan...' : 'Bayar Sekarang'}
          </Button>
          <Button variant="secondary" fullWidth disabled={processing} style={{ marginTop: 10 }} onClick={() => { if (validateCart()) submitOrder({ amount: 0, method: '', payments: [] }); }}>
            Simpan Pesanan (Bayar Nanti)
          </Button>
        </div>
      </div>
      <Modal id="checkout-payment" isOpen={paymentOpen} onClose={() => { if (!processing) setPaymentOpen(false); }} title="Pembayaran Pesanan" maxWidth={500}>
        <PaymentForm total={grandTotal} allowUnpaid busy={processing} error={paymentError} onSubmit={submitOrder} />
      </Modal>
      <Modal isOpen={!!variantProduct} onClose={() => setVariantProduct(null)} title={`Pilih Varian: ${variantProduct?.name || ''}`} maxWidth={550}>
        <div className="variant-options">
          {variantProduct?.variants.map(variant => (
            <button type="button" className="variant-option" key={variant.id} disabled={variant.stock <= 0} onClick={() => addToCart(variantProduct, variant)}>
              <div><strong>{variant.name}</strong>{variant.sku && <small>SKU: {variant.sku}</small>}</div>
              <div><strong>{formatRp(getSellingPrice(variant, isVip))}</strong><small>{variant.stock > 0 ? `Stok: ${variant.stock}` : 'Stok habis'}</small></div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
