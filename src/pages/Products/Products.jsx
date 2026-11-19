import { useEffect, useState } from 'react';
import Input from '../../components/Input/Input';
import Select from '../../components/Select/Select';
import Button from '../../components/Button/Button';
import Alert from '../../components/Alert/Alert';
import Modal from '../../components/Modal/Modal';
import Table from '../../components/Table/Table';
import RowActions from '../../components/RowActions/RowActions';
import PageHeader from '../../components/PageHeader/PageHeader';
import { formatRp } from '../../utils/format';
import './Products.css';
import WholesalePrices from './WholesalePrices';
import BonusPromotion from './BonusPromotion';
import { normalizeWholesalePrices } from '../../../shared/pricing';
import { normalizeBonusPromotion } from '../../../shared/promotions';
import { useAuth } from '../../context/AuthContext';
import IconButton from '../../components/IconButton/IconButton';
import BarcodeLabel from '../../components/BarcodeLabel/BarcodeLabel';

const EMPTY_PRODUCT = { id: '', code: '', name: '', category_id: '', unit_id: '', price: '', purchase_price: '', vip_price: '', wholesale_prices: [], buy_qty: 0, free_qty: 0, stock: '0', variants: [] };
const EMPTY_CATEGORY = { id: '', name: '' };
const EMPTY_UNIT = { id: '', name: '', symbol: '' };

export default function Products() {
  const { can } = useAuth();
  const [barcodeProduct,setBarcodeProduct]=useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [productError, setProductError] = useState('');

  const [productModal, setProductModal] = useState({ open: false, form: EMPTY_PRODUCT, file: null, imagePreview: null });
  const [categoryModal, setCategoryModal] = useState({ open: false, form: EMPTY_CATEGORY });
  const [unitModal, setUnitModal] = useState({ open: false, form: EMPTY_UNIT });
  
  const [previewModal, setPreviewModal] = useState({ open: false, src: '', title: '' });

  const loadData = async () => {
    try {
      const [resProd, resCat, resUnit] = await Promise.all([
        window.api.getProducts(),
        window.api.getCategories(),
        window.api.getUnits(),
      ]);
      setProducts(resProd || []);
      setCategories(resCat || []);
      setUnits(resUnit || []);
    } catch (e) {
      setError('Gagal memuat data produk.');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getImageUrl = (imgName) => {
    return imgName && imgName !== 'default.png' 
      ? `pos-file://${imgName}` 
      : 'https://placehold.co/100x100/e2e8f0/64748b?text=No+Image'; // Placeholder jika tidak ada gambar
  };

  // ===== Produk =====
  const openProductModal = (product = null) => {
    setProductError('');
    setProductModal({
      open: true,
      file: null,
      imagePreview: product?.img && product.img !== 'default.png' ? getImageUrl(product.img) : null,
      form: product
        ? {
            id: product.id,
            code: product.code || '',
            name: product.name || '',
            category_id: product.category_id || '',
            unit_id: product.unit_id || '',
            price: product.price ?? '',
            vip_price: product.vip_price ?? '',
            wholesale_prices: product.wholesale_prices || [],
            buy_qty: product.buy_qty || 0,
            free_qty: product.free_qty || 0,
            purchase_price: product.cost_known ? product.purchase_price : '',
            stock: product.stock || '0',
            variants: (product.variants || []).map(variant => ({ ...variant, key: `saved-${variant.id}` })),
          }
        : EMPTY_PRODUCT,
    });
  };

  const updateVariant = (key, field, value) => setProductModal(previous => ({
    ...previous,
    form: { ...previous.form, variants: previous.form.variants.map(variant => variant.key === key ? { ...variant, [field]: value } : variant) },
  }));

  const addVariant = () => setProductModal(previous => ({
    ...previous,
    form: { ...previous.form, variants: [...previous.form.variants, {
      key: crypto.randomUUID(), name: '', sku: '', purchase_price: '', vip_price: '', wholesale_prices: [], buy_qty: 0, free_qty: 0, price: previous.form.price || '0', stock: '0',
    }] },
  }));

  const removeVariant = (key) => setProductModal(previous => ({
    ...previous, form: { ...previous.form, variants: previous.form.variants.filter(variant => variant.key !== key) },
  }));

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setProductModal({ ...productModal, file, imagePreview: previewUrl });
    } else {
      setProductModal({ ...productModal, file: null, imagePreview: null });
    }
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    if (saving) return;
    const { form, file } = productModal;
    setSaving(true);
    setProductError('');
    try {
      const wholesalePrices = normalizeWholesalePrices(form.wholesale_prices, form.variants.length ? Infinity : form.price);
      const promo = normalizeBonusPromotion(form);
      const variants = form.variants.map(variant => ({ ...variant, ...normalizeBonusPromotion(variant), wholesale_prices: normalizeWholesalePrices(variant.wholesale_prices, variant.price) }));
      let imageName = form.id ? products.find(p => p.id === form.id)?.img || 'default.png' : 'default.png';
      
      if (file) {
        const buffer = await file.arrayBuffer();
        const uploadRes = await window.api.uploadProductImage({ buffer });
        if (!uploadRes.success) throw new Error(uploadRes.message || 'Gagal mengunggah gambar.');
        imageName = uploadRes.fileName;
      }

      const payload = {
        ...promo,
        code: form.code,
        name: form.name,
        category_id: form.category_id || null,
        unit_id: form.unit_id || null,
        price: parseFloat(form.price),
        purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
        vip_price: form.vip_price === '' ? null : Number(form.vip_price),
        wholesale_prices: wholesalePrices,
        stock: parseInt(form.stock),
        img: imageName,
        variants: variants.map(variant => ({
          buy_qty: variant.buy_qty, free_qty: variant.free_qty,
          wholesale_prices: variant.wholesale_prices,
          purchase_price: variant.purchase_price == null || variant.purchase_price === '' ? null : Number(variant.purchase_price), vip_price: variant.vip_price == null || variant.vip_price === '' ? null : Number(variant.vip_price), id: variant.id, name: variant.name, sku: variant.sku, price: Number(variant.price), stock: Number(variant.stock),
        })),
      };

      const result = form.id ? await window.api.updateProduct(form.id, payload) : await window.api.createProduct(payload);
      if (result !== true) throw new Error(result?.message || 'Gagal menyimpan produk.');

      setProductModal({ open: false, form: EMPTY_PRODUCT, file: null, imagePreview: null });
      loadData();
    } catch (err) {
      setProductError(err.message || 'Gagal menyimpan produk.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id) => {
    if (confirm('Yakin ingin menghapus produk ini?')) {
      await window.api.deleteProduct(id);
      loadData();
    }
  };

  const openCategoryModal = (cat = null) => setCategoryModal({ open: true, form: cat ? { id: cat.id, name: cat.name } : EMPTY_CATEGORY });
  const saveCategory = async (e) => {
    e.preventDefault();
    const { form } = categoryModal;
    if (form.id) await window.api.updateCategory(form.id, { name: form.name });
    else await window.api.createCategory({ name: form.name });
    setCategoryModal({ open: false, form: EMPTY_CATEGORY });
    loadData();
  };
  const deleteCategory = async (id) => {
    if (confirm('Hapus kategori ini?')) { await window.api.deleteCategory(id); loadData(); }
  };

  const openUnitModal = (unit = null) => setUnitModal({ open: true, form: unit ? { id: unit.id, name: unit.name, symbol: unit.symbol } : EMPTY_UNIT });
  const saveUnit = async (e) => {
    e.preventDefault();
    const { form } = unitModal;
    if (form.id) await window.api.updateUnit(form.id, { name: form.name, symbol: form.symbol });
    else await window.api.createUnit({ name: form.name, symbol: form.symbol });
    setUnitModal({ open: false, form: EMPTY_UNIT });
    loadData();
  };
  const deleteUnit = async (id) => {
    if (confirm('Hapus satuan ini?')) { await window.api.deleteUnit(id); loadData(); }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.toLowerCase().includes(search.toLowerCase()) ||
      p.variants?.some(variant => `${variant.name} ${variant.sku || ''}`.toLowerCase().includes(search.toLowerCase()))
  );

  const productColumns = [
    { 
      key: 'img', 
      label: 'Gambar',
      headerStyle: { width: '60px', textAlign: 'center' },
      cellStyle: { textAlign: 'center' },
      render: (p) => (
        <img 
          src={getImageUrl(p.img)} 
          alt={p.name} 
          style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', border: '1px solid #e2e8f0', display: 'block', margin: '0 auto' }}
          onClick={() => setPreviewModal({ open: true, src: getImageUrl(p.img), title: p.name })}
        />
      )
    },
    { key: 'code', label: 'Kode' },
    { key: 'name', label: 'Nama Produk', render: (p) => <b>{p.name}</b> },
    { key: 'variants', label: 'Varian', render: (p) => p.variants?.length ? <span title={p.variants.map(v => v.name).join(', ')}>{p.variants.length} varian</span> : '-' },
    { key: 'category_name', label: 'Kategori', render: (p) => p.category_name || '-' },
    { key: 'stock', label: 'Stok', cellStyle: { textAlign: 'center' }, render: (p) => <span className="badge-pill" style={{ background: '#f1f5f9' }}>{p.stock}</span> },
    { key: 'price', label: 'Harga Jual', render: (p) => `${p.variants?.length ? 'Mulai ' : ''}${formatRp(p.price)}` },
  ];

  const categoryColumns = [
    { key: 'id', label: 'ID', headerStyle: { width: 50 } },
    { key: 'name', label: 'Nama Kategori', render: (c) => <b>{c.name}</b> },
  ];

  const unitColumns = [
    { key: 'name', label: 'Nama Satuan', render: (u) => <b>{u.name}</b> },
    { key: 'symbol', label: 'Simbol' },
  ];

  return (
    <div className="products-page">
      <Alert>{error}</Alert>

      <PageHeader
        icon="fas fa-box"
        title="Manajemen Produk"
        actionLabel="Tambah Produk"
        actionIcon="fas fa-plus"
        onAction={() => openProductModal()}
      />

      <div className="card products-table-card">
        <div className="products-search" style={{ marginBottom: '15px', maxWidth: '300px' }}>
          <Input
            placeholder="Cari nama produk atau kode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Table
          columns={productColumns}
          data={filteredProducts}
          emptyText="Tidak ada produk."
          renderActions={(p) => (
            <div className="product-barcode-actions"><RowActions onEdit={() => openProductModal(p)} onDelete={() => deleteProduct(p.id)} /><IconButton icon="fas fa-barcode" variant="secondary" title="Buat Barcode" onClick={()=>setBarcodeProduct(p)} /></div>
          )}
        />
      </div>

      <div className="products-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
        <div>
          <PageHeader
            icon="fas fa-tags"
            title="Kategori"
            actionLabel="Tambah Kategori"
            actionIcon="fas fa-plus"
            onAction={() => openCategoryModal()}
          />
          <div className="card">
            <Table
              columns={categoryColumns}
              data={categories}
              emptyText="Belum ada kategori."
              renderActions={(c) => (
                <RowActions onEdit={() => openCategoryModal(c)} onDelete={() => deleteCategory(c.id)} />
              )}
            />
          </div>
        </div>

        <div>
          <PageHeader
            icon="fas fa-ruler-combined"
            title="Satuan"
            actionLabel="Tambah Satuan"
            actionIcon="fas fa-plus"
            onAction={() => openUnitModal()}
          />
          <div className="card">
            <Table
              columns={unitColumns}
              data={units}
              emptyText="Belum ada satuan."
              renderActions={(u) => (
                <RowActions onEdit={() => openUnitModal(u)} onDelete={() => deleteUnit(u.id)} />
              )}
            />
          </div>
        </div>
      </div>
      {barcodeProduct && <BarcodeLabel product={barcodeProduct} onClose={()=>setBarcodeProduct(null)} onCodeCreated={loadData} />}

      <Modal 
        id="modal-preview-img"
        isOpen={previewModal.open} 
        onClose={() => setPreviewModal({ open: false, src: '', title: '' })} 
        title={previewModal.title}
        icon="fas fa-image"
        maxWidth={500}
      >
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <img 
            src={previewModal.src} 
            alt={previewModal.title} 
            style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '12px', border: '1px solid var(--border-color)' }} 
          />
        </div>
      </Modal>

      <Modal
        id="modal-product"
        isOpen={productModal.open}
        onClose={() => setProductModal({ ...productModal, open: false })}
        icon="fas fa-box"
        title={productModal.form.id ? 'Edit Produk' : 'Tambah Produk Baru'}
        maxWidth={850}
      >
        <form onSubmit={saveProduct}>
          <Alert>{productError}</Alert>
          <div style={{ display: 'flex', gap: '15px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Kode Produk"
                placeholder="Otomatis"
                value={productModal.form.code}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, code: e.target.value } })}
              />
            </div>
            <div style={{ flex: 2 }}>
              <Input
                label="Nama Produk *"
                required
                value={productModal.form.name}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, name: e.target.value } })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <Select
                label="Kategori"
                value={productModal.form.category_id}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, category_id: e.target.value } })}
              >
                <option value="">Pilih...</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Satuan"
                value={productModal.form.unit_id}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, unit_id: e.target.value } })}
              >
                <option value="">Pilih...</option>
                {units.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </Select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <div style={{ flex: 1 }}>
              <Input
                label={productModal.form.variants.length ? 'Harga Terendah (Rp)' : 'Harga Jual (Rp) *'}
                type="number"
                min="0"
                step="0.01"
                required={!productModal.form.variants.length}
                readOnly={!!productModal.form.variants.length}
                value={productModal.form.variants.length ? Math.min(...productModal.form.variants.map(v => Number(v.price) || 0)) : productModal.form.price}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, price: e.target.value } })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label={productModal.form.variants.length ? 'Total Stok Varian' : 'Stok'}
                type="number"
                min="0"
                readOnly={!!productModal.form.variants.length}
                value={productModal.form.variants.length ? productModal.form.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) : productModal.form.stock}
                onChange={(e) => setProductModal({ ...productModal, form: { ...productModal.form, stock: e.target.value } })}
              />
            </div>
          </div>

          {!productModal.form.variants.length && <Input label="Harga VIP (Rp, Opsional)" type="number" min="0" step="0.01" placeholder="Kosongkan untuk memakai harga biasa" value={productModal.form.vip_price} onChange={event => setProductModal({ ...productModal, form: { ...productModal.form, vip_price: event.target.value } })} />}
          {can('cost.view') && <Input label="Harga Modal (Rp, per satuan)" type="number" min="0" step="0.01" placeholder="Isi untuk menghitung laba transaksi berikutnya" value={productModal.form.purchase_price} onChange={event => setProductModal({ ...productModal, form: { ...productModal.form, purchase_price: event.target.value } })} />}
          {!productModal.form.variants.length && <WholesalePrices value={productModal.form.wholesale_prices} onChange={wholesale_prices => setProductModal(previous => ({ ...previous, form: { ...previous.form, wholesale_prices } }))} />}
          {!productModal.form.variants.length && <BonusPromotion value={productModal.form} onChange={promo => setProductModal(previous => ({ ...previous, form: { ...previous.form, ...promo } }))} />}
          <section className="variant-editor">
            <div className="variant-editor-heading">
              <div><strong>Varian Produk</strong><p>Contoh: rasa, ukuran, atau warna. Setiap varian memiliki harga dan stok sendiri.</p></div>
              <Button variant="secondary" icon="fas fa-plus" onClick={addVariant}>Tambah Varian</Button>
            </div>
            {!productModal.form.variants.length && <p className="variant-help">Tanpa varian, produk memakai harga dan stok di atas. Saat menambahkan varian, isi stok setiap varian sesuai persediaan.</p>}
            {productModal.form.variants.map((variant, index) => (
              <div className="variant-editor-row" key={variant.key}>
                <Input label={`Nama Varian ${index + 1} *`} placeholder="Merah / XL" required value={variant.name} onChange={e => updateVariant(variant.key, 'name', e.target.value)} />
                <Input label="SKU (Opsional)" value={variant.sku} onChange={e => updateVariant(variant.key, 'sku', e.target.value)} />
                <Input label="Harga (Rp) *" type="number" min="0" step="0.01" required value={variant.price} onChange={e => updateVariant(variant.key, 'price', e.target.value)} />
                <Input label="Harga VIP (Opsional)" type="number" min="0" step="0.01" placeholder="Harga biasa" value={variant.vip_price ?? ''} onChange={event => updateVariant(variant.key, 'vip_price', event.target.value)} />
                {can('cost.view') && <Input label="Modal Varian (Opsional)" type="number" min="0" step="0.01" placeholder="Modal produk" value={variant.purchase_price ?? ''} onChange={event => updateVariant(variant.key, 'purchase_price', event.target.value)} />}
                <Input label="Stok *" type="number" min="0" step="1" required value={variant.stock} onChange={e => updateVariant(variant.key, 'stock', e.target.value)} />
                <Button variant="danger" aria-label={`Hapus varian ${index + 1}`} onClick={() => removeVariant(variant.key)}><i className="fas fa-trash"></i></Button>
                <WholesalePrices value={variant.wholesale_prices} onChange={value => updateVariant(variant.key, 'wholesale_prices', value)} />
                <BonusPromotion value={variant} onChange={promo => setProductModal(previous => ({ ...previous, form: { ...previous.form, variants: previous.form.variants.map(row => row.key === variant.key ? { ...row, ...promo } : row) } }))} />
              </div>
            ))}
          </section>

          <div style={{ marginBottom: '20px', padding: '15px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', background: '#e2e8f0', display: 'flex', justifyContent: 'center', alignItems: 'center', border: '2px solid white', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              {productModal.imagePreview ? (
                <img src={productModal.imagePreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <i className="fas fa-image" style={{ color: '#94a3b8', fontSize: '24px' }}></i>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--dark)', display: 'block', marginBottom: '6px' }}>Upload Gambar Produk (Opsional)</label>
              <input
                type="file"
                className="input-field"
                accept="image/png, image/jpeg, image/webp"
                onChange={handleFileChange}
                style={{ padding: '6px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="submit" variant="success" fullWidth disabled={saving} style={{ justifyContent: 'center', height: '42px' }}>
              {saving ? 'Menyimpan...' : 'Simpan Produk'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setProductModal({ ...productModal, open: false })}>
              Batal
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        id="modal-category"
        isOpen={categoryModal.open}
        onClose={() => setCategoryModal({ ...categoryModal, open: false })}
        title={categoryModal.form.id ? "Edit Kategori" : "Tambah Kategori"}
        icon="fas fa-tags"
        maxWidth={400}
      >
        <form onSubmit={saveCategory}>
          <div style={{ marginBottom: '20px' }}>
            <Input
              label="Nama Kategori"
              required
              value={categoryModal.form.name}
              onChange={(e) => setCategoryModal({ ...categoryModal, form: { ...categoryModal.form, name: e.target.value } })}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="submit" variant="success" fullWidth style={{ justifyContent: 'center' }}>Simpan</Button>
            <Button type="button" variant="secondary" onClick={() => setCategoryModal({ ...categoryModal, open: false })}>Batal</Button>
          </div>
        </form>
      </Modal>

      <Modal
        id="modal-unit"
        isOpen={unitModal.open}
        onClose={() => setUnitModal({ ...unitModal, open: false })}
        title={unitModal.form.id ? "Edit Satuan" : "Tambah Satuan"}
        icon="fas fa-ruler-combined"
        maxWidth={400}
      >
        <form onSubmit={saveUnit}>
          <div style={{ marginBottom: '12px' }}>
            <Input
              label="Nama Satuan"
              required
              value={unitModal.form.name}
              onChange={(e) => setUnitModal({ ...unitModal, form: { ...unitModal.form, name: e.target.value } })}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <Input
              label="Simbol (Opsional)"
              placeholder="Contoh: Pcs, Kg, Box"
              value={unitModal.form.symbol}
              onChange={(e) => setUnitModal({ ...unitModal, form: { ...unitModal.form, symbol: e.target.value } })}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="submit" variant="success" fullWidth style={{ justifyContent: 'center' }}>Simpan</Button>
            <Button type="button" variant="secondary" onClick={() => setUnitModal({ ...unitModal, open: false })}>Batal</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
