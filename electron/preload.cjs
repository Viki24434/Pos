const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // ===== Aktivasi & Lisensi =====
  checkActivation: () => ipcRenderer.invoke('check-activation'),
  activateDevice: (lisensiInput) => ipcRenderer.invoke('activate-device', lisensiInput),

  // ===== Auth =====
  login: (credentials) => ipcRenderer.invoke('auth-login', credentials),
  logout: () => ipcRenderer.invoke('auth-logout'),
  checkAuth: () => ipcRenderer.invoke('check-auth'),
  getIpAddress: () => ipcRenderer.invoke('get-ip-address'),

  // ===== Dashboard =====
  getDashboardData: () => ipcRenderer.invoke('get-dashboard-data'),

  // ===== Settings =====
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),

  // ===== Products =====
  getProducts: () => ipcRenderer.invoke('get-products'),
  getSuppliers: () => ipcRenderer.invoke('get-suppliers'),
  saveSupplier: (data) => ipcRenderer.invoke('save-supplier', data),
  getStockReceipts: (filters) => ipcRenderer.invoke('get-stock-receipts', filters),
  getStockReceiptDetail: (id) => ipcRenderer.invoke('get-stock-receipt-detail', id),
  createStockReceipt: (data) => ipcRenderer.invoke('create-stock-receipt', data),
  getProduct: (id) => ipcRenderer.invoke('get-product', id),
  createProduct: (data) => ipcRenderer.invoke('create-product', data),
  updateProduct: (id, data) => ipcRenderer.invoke('update-product', id, data),
  deleteProduct: (id) => ipcRenderer.invoke('delete-product', id),
  uploadProductImage: (payload) => ipcRenderer.invoke('upload-product-image', payload),

  // ===== Categories =====
  getCategories: () => ipcRenderer.invoke('get-categories'),
  createCategory: (data) => ipcRenderer.invoke('create-category', data),
  updateCategory: (id, data) => ipcRenderer.invoke('update-category', id, data),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),

  // ===== Units =====
  getUnits: () => ipcRenderer.invoke('get-units'),
  createUnit: (data) => ipcRenderer.invoke('create-unit', data),
  updateUnit: (id, data) => ipcRenderer.invoke('update-unit', id, data),
  deleteUnit: (id) => ipcRenderer.invoke('delete-unit', id),

  // ===== Customers =====
  getCustomers: () => ipcRenderer.invoke('get-customers'),
  createCustomer: (data) => ipcRenderer.invoke('create-customer', data),
  updateCustomer: (id, data) => ipcRenderer.invoke('update-customer', id, data),
  deleteCustomer: (id) => ipcRenderer.invoke('delete-customer', id),

  // ===== Users =====
  getUsers: () => ipcRenderer.invoke('get-users'),

  // ===== Orders / POS =====
  getOrders: (filters) => ipcRenderer.invoke('get-orders', filters),
  getReceivables: (filters) => ipcRenderer.invoke('get-receivables', filters),
  setReceivableDueDate: (id, dueDate) => ipcRenderer.invoke('set-receivable-due-date', id, dueDate),
  getOrderDetail: (id) => ipcRenderer.invoke('get-order-detail', id),
  getOrderPayments: (id) => ipcRenderer.invoke('get-order-payments', id),
  getPrintData: (id) => ipcRenderer.invoke('get-print-data', id),
  previewReceipt: (id, paper) => ipcRenderer.invoke('preview-receipt', id, paper),
  printReceipt: (id, paper) => ipcRenderer.invoke('print-receipt', id, paper),
  getPrintSettings: () => ipcRenderer.invoke('get-print-settings'),
  savePrintSettings: (data) => ipcRenderer.invoke('save-print-settings', data),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  createOrder: (data) => ipcRenderer.invoke('create-order', data),
  processPayment: (data) => ipcRenderer.invoke('process-payment', data),
  getPaymentMethods: (options) => ipcRenderer.invoke('get-payment-methods', options),
  createPaymentMethod: (data) => ipcRenderer.invoke('create-payment-method', data),
  setPaymentMethodActive: (id, active) => ipcRenderer.invoke('set-payment-method-active', id, active),

  // ===== Finance =====
  getFinanceSummary: (filter) => ipcRenderer.invoke('get-finance-summary', filter),
  storeIncome: (data) => ipcRenderer.invoke('store-income', data),
  storeExpenditure: (data) => ipcRenderer.invoke('store-expenditure', data),

  // ===== Reports =====
  getSalesReport: (filter) => ipcRenderer.invoke('get-sales-report', filter),
  getSalesProfitReport: (filter) => ipcRenderer.invoke('get-sales-profit-report', filter),
  saveOrderCosts: (orderId, costs) => ipcRenderer.invoke('save-order-costs', orderId, costs),
  getProductReport: () => ipcRenderer.invoke('get-product-report'),
  getCustomerReport: (filter) => ipcRenderer.invoke('get-customer-report', filter),
  getPaymentMethodReport: (filter) => ipcRenderer.invoke('get-payment-method-report', filter),
  getReceivablesReport: () => ipcRenderer.invoke('get-receivables-report'),
  getIncomeExpenditureReport: (filter) => ipcRenderer.invoke('get-income-expenditure-report', filter),
  getProfitLossReport: (filter) => ipcRenderer.invoke('get-profit-loss-report', filter),

});
