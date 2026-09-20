import Dexie from 'dexie';
import { TURKISH_BARCODE_CATALOG } from '../data/barcodeCatalog';

export const db = new Dexie('MarketPosDB');

db.version(1).stores({
  products: '++id, &barcode, name, category, price, isQuick, stock',
  sales: '++id, &receiptNo, date, paymentMethod, customerId, status',
  customers: '++id, name, phone, balance',
  customerTransactions: '++id, customerId, date, type',
  suspendedSales: '++id, createdAt',
  settings: '&key'
});

db.version(2).stores({
  users: '++id, name, pin, role'
});

db.version(3).stores({
  customers: '++id, name, phone, balance, autoReminderEnabled, reminderFrequency, lastReminderAt, nextReminderAt',
  customerTransactions: '++id, customerId, date, type'
});

db.version(4).stores({
  purchaseInvoices: '++id, invoiceNo, supplierName, date, createdAt'
});

db.version(5).stores({
  supplierPayments: '++id, supplierName, date, paymentMethod, createdAt'
});

/**
 * Arka plan kütüphanesinden sisteme yüklenmiş veya eski örnek ürünleri temizler.
 * Kullanıcı "Tüm Ürünler"de sadece kendi eklediği veya okutup fiyat belirlediği ürünleri görür.
 * Barkod kütüphanesi görünmez olarak arkaplanda kalır; ilk okutmada sadece ismini alır.
 */
export async function cleanupPreloadedProducts() {
  try {
    // 1. Fiyatı henüz belirlenmemiş / needsPricing olan tüm kütüphane ürünlerini ürün listesinden temizle
    const unpriced = await db.products.filter(p => p.needsPricing === true || (!p.price && !p.buyPrice)).toArray();
    if (unpriced.length > 0) {
      await db.products.bulkDelete(unpriced.map(p => p.id));
      console.log(`[DB] ${unpriced.length} adet arkaplan kütüphane ürünü listeden kaldırıldı.`);
    }

    // 2. Bir defaya mahsus eski başlangıç örnek ürünlerini (Ekmek, Simit vb.) temizle
    const isCleaned = await db.settings.get('cleaned_preloaded_products_v2');
    if (!isCleaned) {
      const initialSeedBarcodes = [
        '869000100001', '869000100002', '869000100003', '869000100004',
        '8690504031201', '8690526010017', '8690533010101', '5449000000996',
        '8690562001011', '8690504000054', '8690637000010', '8690506001011'
      ];
      const dummyItems = await db.products.filter(p => initialSeedBarcodes.includes(p.barcode)).toArray();
      if (dummyItems.length > 0) {
        await db.products.bulkDelete(dummyItems.map(p => p.id));
        console.log(`[DB] ${dummyItems.length} adet eski örnek ürün temizlendi.`);
      }
      await db.settings.put({ key: 'cleaned_preloaded_products_v2', value: true });
    }
  } catch (err) {
    console.warn('[DB] cleanupPreloadedProducts hatası:', err);
  }
}

export async function seedInternetBarcodes() {
  // Arkaplan kütüphanesi artık veritabanını kirletmiyor; doğrudan bellekten ve API'den çalışıyor.
  await cleanupPreloadedProducts();
  return 0;
}

// Seed initial database defaults (customers, settings, users). No preloaded dummy products!
export async function seedInitialData() {
  // Arka plan kütüphanesini ve eski örnek ürünleri temizle
  await cleanupPreloadedProducts();

  const allCustomers = await db.customers.toArray();
  for (const c of allCustomers) {
    const shouldUpdate = !('autoReminderEnabled' in c) || !('reminderFrequency' in c) || !('nextReminderAt' in c) || !('lastReminderAt' in c) || !('updatedAt' in c);
    if (shouldUpdate) {
      await db.customers.update(c.id, {
        autoReminderEnabled: c.autoReminderEnabled ?? (c.balance > 0),
        reminderFrequency: c.reminderFrequency ?? 'weekly',
        lastReminderAt: c.lastReminderAt ?? null,
        nextReminderAt: c.nextReminderAt ?? new Date().toISOString(),
        updatedAt: c.updatedAt || c.createdAt || new Date().toISOString()
      });
    }
  }

  // Otomatik Bakiye İyileştirme (Self-Healing):
  // Geçmişte veresiye kaydedilip bakiyesi 0'a sıfırlanan müşterileri hareketlerinden onarır
  await reconcileCustomerBalances();

  // Seed default settings if empty
  const storeName = await db.settings.get('storeName');
  if (!storeName) {
    await db.settings.bulkPut([
      { key: 'storeName', value: 'KURŞUNLU MARKET' },
      { key: 'storeAddress', value: 'Merkez Mah. Atatürk Cad. No: 42' },
      { key: 'storePhone', value: '0212 555 00 11' },
      { key: 'taxId', value: 'VKN: 1234567890' },
      { key: 'receiptFooter', value: 'Bizi tercih ettiğiniz için teşekkür ederiz! Yine bekleriz.' },
      { key: 'soundEnabled', value: true },
      { key: 'vibrationEnabled', value: true },
      { key: 'syncServerUrl', value: 'ws://192.168.1.103:5174' },
      { key: 'gdrive_sync_url', value: 'https://script.google.com/macros/s/AKfycbynKmHnlT3s2X-elSRjkM4Bb8L85hKN8OF_FatDO0VqFVsOq_JrWmHIeTgZu3lB2MUP/exec' },
      { key: 'gdrive_auto_sync', value: '1s' }
    ]);
  }

  // Seed default users if empty
  const userCount = await db.users.count();
  if (userCount === 0) {
    await db.users.bulkAdd([
      {
        name: 'Müdür (Admin)',
        pin: '1234',
        role: 'admin',
        permissions: {
          canAccessPos: true,
          canApplyDiscount: true,
          canCancelSale: true,
          canAccessProducts: true,
          canEditProducts: true,
          canViewBuyPrice: true,
          canAccessCustomers: true,
          canManageDebt: true,
          canAccessReports: true,
          canAccessSettings: true,
          canManageUsers: true
        }
      },
      {
        name: 'Kasiyer (Çalışan)',
        pin: '0000',
        role: 'cashier',
        permissions: {
          canAccessPos: true,
          canApplyDiscount: false,
          canCancelSale: false,
          canAccessProducts: false,
          canEditProducts: false,
          canViewBuyPrice: false,
          canAccessCustomers: false,
          canManageDebt: false,
          canAccessReports: false,
          canAccessSettings: true, // Her kullanıcı senkronizasyon ve Drive ayarı yapabilsin
          canManageUsers: false
        }
      }
    ]);
  }

  // Her kullanıcının Google Drive senkronizasyon ayarlarını yapabilmesi için izni açık tut
  try {
    const existingUsers = await db.users.toArray();
    for (const u of existingUsers) {
      if (u.permissions && !u.permissions.canAccessSettings) {
        await db.users.update(u.id, {
          permissions: { ...u.permissions, canAccessSettings: true }
        });
      }
    }
  } catch (err) {
    // ignore
  }

  // Always ensure Turkish market barcode catalog is loaded in background
  await seedInternetBarcodes();
}

/**
 * Bir defaya mahsus başlangıç temizliği: son 30 günlük örnek satışları
 * ve eski demo veresiye kayıtlarını kaldırır; kullanıcı verilerini tekrar silmez.
 */
export async function removeInitialDemoData() {
  const cleanupKey = 'initial_demo_data_removed_v1';
  if (await db.settings.get(cleanupKey)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recentSales = await db.sales.filter(sale => new Date(sale.date) >= cutoff).toArray();
  if (recentSales.length > 0) {
    await db.sales.bulkDelete(recentSales.map(sale => sale.id));
  }

  const demoNames = new Set([
    'Ahmet Yılmaz (Komşu)',
    'Fatma Teyze',
    'Mehmet Usta (Oto Tamir)'
  ]);
  const demoCustomers = await db.customers.filter(customer => demoNames.has(customer.name)).toArray();
  if (demoCustomers.length > 0) {
    const demoIds = new Set(demoCustomers.map(customer => customer.id));
    const demoTransactions = await db.customerTransactions
      .filter(transaction => demoIds.has(transaction.customerId))
      .toArray();
    await db.customerTransactions.bulkDelete(demoTransactions.map(transaction => transaction.id));
    await db.customers.bulkDelete(demoCustomers.map(customer => customer.id));
  }

  await db.settings.put({ key: cleanupKey, value: new Date().toISOString() });
}

export async function switchToMarket(marketId) {
  if (!marketId) throw new Error('Market kimliği bulunamadı.');
  const active = await db.settings.get('active_market_id');
  if (active?.value && active.value !== marketId) {
    await Promise.all([
      db.products.clear(),
      db.sales.clear(),
      db.customers.clear(),
      db.customerTransactions.clear(),
      db.suspendedSales.clear(),
      db.users.clear()
    ]);
  }
  await db.settings.put({ key: 'active_market_id', value: marketId });
}

/**
 * Otomatik Bakiye İyileştirme (Reconciliation):
 * Müşterinin hareketlerindeki (customerTransactions) net borç-tahsilat farkı ile
 * müşterinin balance alanını karşılaştırır; 0'a düşmüş veya eksik kayıtları onarır.
 */
export async function reconcileCustomerBalances() {
  try {
    const customers = await db.customers.toArray();
    const transactions = await db.customerTransactions.toArray();

    const txByCust = new Map();
    for (const tx of transactions) {
      if (!tx.customerId) continue;
      const cid = String(tx.customerId);
      if (!txByCust.has(cid)) txByCust.set(cid, []);
      txByCust.get(cid).push(tx);
    }

    for (const cust of customers) {
      const cid = String(cust.id);
      const custTxs = txByCust.get(cid) || [];
      if (custTxs.length > 0) {
        const totalDebt = custTxs.filter(t => t.type === 'debt').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalPayment = custTxs.filter(t => t.type === 'payment').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const netBalance = Math.max(0, totalDebt - totalPayment);
        const currentBalance = Number(cust.balance) || 0;

        if (currentBalance === 0 && netBalance > 0) {
          console.log(`[DB] Otomatik onarım: ${cust.name} bakiyesi ₺${netBalance.toFixed(2)} olarak güncellendi.`);
          await db.customers.update(cust.id, {
            balance: netBalance,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  } catch (err) {
    console.warn('[DB] reconcileCustomerBalances hatası:', err);
  }
}
