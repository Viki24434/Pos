CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT NULL,
  address TEXT DEFAULT NULL,
  tax_percentage REAL DEFAULT 0.00,
  logo TEXT DEFAULT 'default.png',
  receipt_paper TEXT NOT NULL DEFAULT '80mm',
  printer_name TEXT NOT NULL DEFAULT '',
  print_direct INTEGER NOT NULL DEFAULT 0,
  footer TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(50) NOT NULL,
  symbol VARCHAR(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  is_member INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Umum' CHECK(status IN ('Umum', 'Member', 'VIP')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenditure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT CHECK(payment_method IN ('Cash','Transfer')) NOT NULL DEFAULT 'Cash'
);

CREATE TABLE IF NOT EXISTS finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  date DATE NOT NULL,
  cash_revenue DECIMAL(15,2) DEFAULT 0.00,
  transfer_revenue DECIMAL(15,2) DEFAULT 0.00,
  qris_revenue DECIMAL(15,2) DEFAULT 0.00,
  other_revenue DECIMAL(15,2) DEFAULT 0.00,
  cash_income DECIMAL(15,2) DEFAULT 0.00,
  transfer_income DECIMAL(15,2) DEFAULT 0.00,
  cash_expenditure DECIMAL(15,2) DEFAULT 0.00,
  transfer_expenditure DECIMAL(15,2) DEFAULT 0.00,
  UNIQUE (store_id, date)
);

CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT CHECK(payment_method IN ('Cash','Transfer')) NOT NULL DEFAULT 'Cash'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT CHECK(role IN ('Admin','Kasir','Super Admin')) DEFAULT 'Kasir',
  name TEXT DEFAULT NULL,
  FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code VARCHAR(50) DEFAULT NULL,
  category_id INTEGER DEFAULT NULL,
  unit_id INTEGER DEFAULT NULL,
  store_id INTEGER NOT NULL,
  purchase_price DECIMAL(15,2) DEFAULT 0.00,
  cost_known INTEGER NOT NULL DEFAULT 0,
  vip_price REAL DEFAULT NULL CHECK(vip_price IS NULL OR vip_price >= 0),
  name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INTEGER DEFAULT 0,
  img VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
  FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_unit_id ON products(unit_id);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  purchase_price REAL DEFAULT NULL CHECK(purchase_price IS NULL OR purchase_price >= 0),
  vip_price REAL DEFAULT NULL CHECK(vip_price IS NULL OR vip_price >= 0),
  price REAL NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL DEFAULT 1,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 1,
  invoice_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(15,2) DEFAULT 0.00,
  discount_amount DECIMAL(15,2) DEFAULT 0.00,
  status VARCHAR(50) DEFAULT 'Pending',
  payment_status TEXT CHECK(payment_status IN ('Belum Bayar','DP','Lunas')) DEFAULT 'Belum Bayar',
  due_date DATE DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (invoice_number),
  FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  description TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_histories_order_id ON order_histories(order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER REFERENCES product_variants(id),
  variant_name TEXT,
  variant_sku TEXT,
  purchase_price REAL DEFAULT NULL CHECK(purchase_price IS NULL OR purchase_price >= 0),
  qty INTEGER NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  subtotal DECIMAL(15,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL DEFAULT 1,
  name TEXT COLLATE NOCASE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('cash','transfer','qris','other')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(store_id, name)
);
INSERT OR IGNORE INTO payment_methods (store_id, name, kind) VALUES (1, 'Cash', 'cash'), (1, 'Transfer', 'transfer');

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_method_id INTEGER REFERENCES payment_methods(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  store_id INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

INSERT INTO stores (id, name, phone, address) 
SELECT 1, 'Toko Utama', '-', '-' 
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 1);

INSERT INTO users (store_id, username, password, role, name) 
SELECT 1, 'admin', 'admin', 'Super Admin', 'Administrator' 
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
