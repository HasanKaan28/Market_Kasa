import { db } from '../db/db';

export const DEFAULT_GDRIVE_URL = 'https://script.google.com/macros/s/AKfycbynKmHnlT3s2X-elSRjkM4Bb8L85hKN8OF_FatDO0VqFVsOq_JrWmHIeTgZu3lB2MUP/exec';

class GoogleDriveSyncManager {
  constructor() {
    this.marketId = 'unassigned';
    this.marketName = '';
    this.syncUrl = DEFAULT_GDRIVE_URL;
    this.autoSyncInterval = '1s'; // '1s' (Canlı/Her saniye), '5s', 'on_sale', 'off'
    this.status = 'idle'; // 'idle', 'syncing', 'success', 'error'
    this.lastSyncTime = null;
    this.lastError = null;
    this.lastCloudTimestamp = 0;
    this.listeners = new Set();
    this.pollTimer = null;
    this.isSyncing = false;
    this.hasPendingPush = false;
    this.marketPassword = '';
    this.marketEmail = '';
  }

  setMarketContext(marketId, marketName = '', marketPassword = '', marketEmail = '') {
    this.marketId = marketId || 'unassigned';
    this.marketName = marketName;
    if (marketPassword) this.marketPassword = marketPassword;
    if (marketEmail) this.marketEmail = marketEmail;
    this.lastCloudTimestamp = 0;
    this.lastSyncTime = null;
  }

  settingKey(key) {
    return `market_${this.marketId}_${key}`;
  }

  async init() {
    try {
      const urlSetting = await db.settings.get(this.settingKey('gdrive_sync_url'));
      if (urlSetting?.value && urlSetting.value.startsWith('http')) {
        this.syncUrl = urlSetting.value;
      } else {
        this.syncUrl = DEFAULT_GDRIVE_URL;
        await db.settings.put({ key: this.settingKey('gdrive_sync_url'), value: DEFAULT_GDRIVE_URL });
      }

      const autoSetting = await db.settings.get(this.settingKey('gdrive_auto_sync'));
      if (autoSetting?.value && autoSetting.value !== 'off') {
        this.autoSyncInterval = autoSetting.value;
      } else {
        this.autoSyncInterval = '1s';
        await db.settings.put({ key: this.settingKey('gdrive_auto_sync'), value: '1s' });
      }

      const lastSyncSetting = await db.settings.get(this.settingKey('gdrive_last_sync'));
      if (lastSyncSetting?.value) {
        this.lastSyncTime = lastSyncSetting.value;
      }

      if (typeof window !== 'undefined' && !this.onlineListenerRegistered) {
        this.onlineListenerRegistered = true;
        window.addEventListener('online', () => {
          console.log('[GDrive] Cihaz internete bağlandı, otomatik tam eşitleme başlatılıyor...');
          this.fullSync();
        });
      }

      this.startPollingLoop();
    } catch (e) {
      console.warn('[GDrive] Başlatma hatası:', e);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    const state = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error(err);
      }
    });
  }

  getState() {
    return {
      status: this.status,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      syncUrl: this.syncUrl,
      autoSyncInterval: this.autoSyncInterval,
      isConfigured: Boolean(this.syncUrl && this.syncUrl.startsWith('http'))
    };
  }

  async setSyncUrl(url) {
    this.syncUrl = url.trim();
    await db.settings.put({ key: this.settingKey('gdrive_sync_url'), value: this.syncUrl });
    this.startPollingLoop();
    this.notifyListeners();
  }

  async setAutoSyncInterval(val) {
    this.autoSyncInterval = val;
    await db.settings.put({ key: this.settingKey('gdrive_auto_sync'), value: val });
    this.startPollingLoop();
    this.notifyListeners();
  }

  /**
   * Sürekli canlı kontrol döngüsü:
   * '1s' modunda her 1.5 - 2 saniyede bir Google Drive'ı kontrol eder.
   * Başka bir telefonda satış yapıldığında bu telefon hemen algılar,
   * satışları Dexie veritabanına ekler ve ciro anında güncellenir!
   */
  startPollingLoop() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (!this.syncUrl || this.autoSyncInterval === 'off' || this.autoSyncInterval === 'on_sale') {
      return;
    }

    const intervalMs = this.autoSyncInterval === '5s' ? 5000 : 1500; // 1s için 1.5 sn

    const runPoll = async () => {
      if (!this.syncUrl || this.autoSyncInterval === 'off' || this.autoSyncInterval === 'on_sale') return;

      if (!this.isSyncing) {
        await this.pullAndMerge();
      }

      this.pollTimer = setTimeout(runPoll, intervalMs);
    };

    this.pollTimer = setTimeout(runPoll, intervalMs);
  }

  /**
   * Yerel telefonda satış yapıldığında veya stok değiştiğinde anında buluta yükler
   */
  async triggerOnSaleSync() {
    if (!this.syncUrl) return;
    if (this.isSyncing) {
      this.hasPendingPush = true;
      return;
    }
    // Satış Dexie'ye yazıldıktan hemen sonra (100ms) Google Drive'a push et
    setTimeout(() => {
      this.fullSync();
    }, 100);
  }

  /**
   * Hafif ve hızlı çekme & birleştirme fonksiyonu:
   * Google Drive'dan güncel veriyi çeker ve yerel Dexie ile birleştirir.
   * Yeniden buluta yükleme yapmaz (böylece gereksiz kota harcamaz).
   */
  async pullAndMerge() {
    if (!this.syncUrl || this.isSyncing) return;
    this.isSyncing = true;

    try {
      // ?since= parametresi ile sunucunun dosya güncelleme saatini hafif kontrol et
      const checkUrlObject = new URL(this.syncUrl);
      checkUrlObject.searchParams.set('marketId', this.marketId);
      if (this.lastCloudTimestamp > 0) {
        checkUrlObject.searchParams.set('since', this.lastCloudTimestamp);
      }
      const checkUrl = checkUrlObject.toString();

      const res = await fetch(checkUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // Sunucu dosya değişmedi dediyse işlemi hemen bitir
      if (data.unchanged || data.upToDate) {
        if (data.serverTime) {
          this.lastCloudTimestamp = data.serverTime;
        }
        if (this.status !== 'success') {
          this.status = 'success';
          this.notifyListeners();
        }
        return;
      }

      if (data && !data.empty) {
        const mergeResult = await this.mergeCloudData(data);
        if (data.serverTime) {
          this.lastCloudTimestamp = data.serverTime;
        } else if (data.timestamp) {
          this.lastCloudTimestamp = new Date(data.timestamp).getTime();
        } else {
          this.lastCloudTimestamp = 0; // Eski script fallback
        }

        this.status = 'success';
        this.lastSyncTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        await db.settings.put({ key: this.settingKey('gdrive_last_sync'), value: this.lastSyncTime });
        this.notifyListeners();
      }
    } catch (err) {
      if (this.status !== 'error') {
        this.status = 'error';
        this.lastError = err.message || 'Bağlantı kesildi';
        this.notifyListeners();
      }
    } finally {
      this.isSyncing = false;
      if (this.hasPendingPush) {
        this.hasPendingPush = false;
        setTimeout(() => this.fullSync(), 100);
      }
    }
  }

  /**
   * Export all local database tables as a clean JSON object
   */
  async exportDataset() {
    const rawProducts = await db.products.toArray();
    // Yalnızca kullanıcının kendi eklediği veya fiyatlandırdığı aktif ürünleri buluta aktar
    const products = rawProducts.filter(p => !p.needsPricing && p.price > 0);
    const sales = await db.sales.toArray();
    const customers = await db.customers.toArray();
    const customerTransactions = await db.customerTransactions.toArray();
    const users = await db.users.toArray();
    const settings = await db.settings.toArray();
    const purchaseInvoices = db.purchaseInvoices ? await db.purchaseInvoices.toArray() : [];
    const supplierPayments = db.supplierPayments ? await db.supplierPayments.toArray() : [];

    return {
      appName: 'MarketKasa',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      products,
      sales,
      customers,
      customerTransactions,
      users,
      purchaseInvoices,
      supplierPayments,
      marketId: this.marketId,
      marketName: this.marketName,
      marketPassword: this.marketPassword || '',
      marketEmail: this.marketEmail || '',
      settings: settings.filter(s => !s.key.includes('gdrive_')) // Don't overwrite Drive configs
    };
  }

  /**
   * Directly fetch market dataset from Google Drive without changing current state
   */
  async fetchMarketDirectly(targetMarketId) {
    try {
      const url = new URL(this.syncUrl || DEFAULT_GDRIVE_URL);
      if (targetMarketId) {
        url.searchParams.set('marketId', targetMarketId);
      }
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn('[GDrive Direct Fetch Error]:', e);
      return null;
    }
  }

  /**
   * Smart Conflict-Free Merge:
   * Merges cloud data with local Dexie database without losing local sales or changes.
   */
  async mergeCloudData(cloud) {
    if (!cloud || typeof cloud !== 'object') return { merged: false };
    if (cloud.marketId && cloud.marketId !== this.marketId && cloud.marketId !== 'unassigned' && this.marketId !== 'unassigned') {
      console.warn(`[GDrive Sync] Market kimliği farklı (${cloud.marketId} -> ${this.marketId}), yine de birleştiriliyor.`);
    }

    let addedSales = 0;
    let addedProducts = 0;
    let updatedProducts = 0;
    let addedCustomers = 0;

    // 1. Merge Sales (by receiptNo)
    if (Array.isArray(cloud.sales)) {
      const localSales = await db.sales.toArray();
      const localReceipts = new Set(localSales.map(s => s.receiptNo));

      const newSales = cloud.sales.filter(s => s.receiptNo && !localReceipts.has(s.receiptNo));
      if (newSales.length > 0) {
        // Strip auto-increment ID to prevent collisions
        const toAdd = newSales.map(({ id, ...rest }) => rest);
        await db.sales.bulkAdd(toAdd);
        addedSales = toAdd.length;

        // Deduct local stock for items in new incoming sales
        for (const sale of newSales) {
          if (Array.isArray(sale.items)) {
            for (const item of sale.items) {
              if (item.id) {
                const prod = await db.products.get(item.id);
                if (prod && prod.stock !== undefined) {
                  await db.products.update(prod.id, {
                    stock: Math.max(0, prod.stock - (item.quantity || 1))
                  });
                }
              }
            }
          }
        }
      }
    }

    // 2. Merge Products (by barcode)
    if (Array.isArray(cloud.products)) {
      const localProducts = await db.products.toArray();
      const localBarcodeMap = new Map(localProducts.map(p => [p.barcode, p]));

      for (const cp of cloud.products) {
        if (!cp.barcode) continue;
        // Buluttan gelen ürün henüz fiyatlanmamış veya arkaplan kütüphane artığı ise atla
        if (cp.needsPricing || (!cp.price && !cp.buyPrice)) continue;

        const local = localBarcodeMap.get(cp.barcode);

        if (!local) {
          const { id, ...newProd } = cp;
          await db.products.add(newProd);
          addedProducts++;
        } else {
          // If cloud has newer updatedAt or different values
          const cloudTime = cp.updatedAt ? new Date(cp.updatedAt).getTime() : 0;
          const localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;

          if (cloudTime > localTime || (cp.price !== local.price || cp.stock !== local.stock)) {
            await db.products.update(local.id, {
              name: cp.name,
              category: cp.category,
              price: cp.price,
              buyPrice: cp.buyPrice !== undefined ? cp.buyPrice : local.buyPrice,
              stock: cp.stock,
              unit: cp.unit,
              taxRate: cp.taxRate,
              color: cp.color,
              isQuick: cp.isQuick,
              updatedAt: cp.updatedAt || new Date().toISOString()
            });
            updatedProducts++;
          }
        }
      }
    }

    // 3. Merge Customers (by phone or name)
    const cloudToLocalCustomerIdMap = new Map();
    if (Array.isArray(cloud.customers)) {
      const localCustomers = await db.customers.toArray();
      const localPhoneMap = new Map(localCustomers.filter(c => c.phone).map(c => [c.phone.trim(), c]));
      const localNameMap = new Map(localCustomers.map(c => [c.name?.toLowerCase().trim(), c]));

      for (const cc of cloud.customers) {
        if (!cc.name) continue;
        const normPhone = cc.phone ? cc.phone.trim() : '';
        const normName = cc.name.toLowerCase().trim();
        const match = (normPhone && localPhoneMap.get(normPhone)) || localNameMap.get(normName);

        if (!match) {
          const { id, ...newCust } = cc;
          const newLocalId = await db.customers.add({
            ...newCust,
            updatedAt: cc.updatedAt || new Date().toISOString()
          });
          cloudToLocalCustomerIdMap.set(cc.id, newLocalId);
          addedCustomers++;
        } else {
          cloudToLocalCustomerIdMap.set(cc.id, match.id);
          const cloudTime = cc.updatedAt ? new Date(cc.updatedAt).getTime() : 0;
          const localTime = match.updatedAt ? new Date(match.updatedAt).getTime() : 0;

          // Only update local from cloud if cloud is genuinely newer
          if (cloudTime > localTime || (cloudTime === 0 && localTime === 0 && (!match.balance || match.balance === 0) && cc.balance > 0)) {
            await db.customers.update(match.id, {
              balance: cc.balance !== undefined ? cc.balance : match.balance,
              phone: cc.phone || match.phone,
              name: cc.name || match.name,
              address: cc.address !== undefined ? cc.address : match.address,
              notes: cc.notes !== undefined ? cc.notes : match.notes,
              limit: cc.limit !== undefined ? cc.limit : match.limit,
              updatedAt: cc.updatedAt || new Date().toISOString()
            });
          }
        }
      }
    }

    // 4. Merge Customer Transactions
    if (Array.isArray(cloud.customerTransactions)) {
      const localTxs = await db.customerTransactions.toArray();
      const localTxKeys = new Set(localTxs.map(t => `${t.customerId}_${t.date}_${t.amount}`));
      for (const ctx of cloud.customerTransactions) {
        const localCid = cloudToLocalCustomerIdMap.get(ctx.customerId) || ctx.customerId;
        const key = `${localCid}_${ctx.date}_${ctx.amount}`;
        if (!localTxKeys.has(key)) {
          const { id, ...newTx } = ctx;
          await db.customerTransactions.add({
            ...newTx,
            customerId: localCid
          });
        }
      }
    }

    // 5. Merge Users (by PIN or name)
    if (Array.isArray(cloud.users)) {
      const localUsers = await db.users.toArray();
      const localPinMap = new Map(localUsers.map(u => [u.pin, u]));

      for (const cu of cloud.users) {
        if (!localPinMap.has(cu.pin)) {
          const { id, ...newUser } = cu;
          await db.users.add(newUser);
        }
      }
    }

    // 6. Merge Purchase Invoices
    if (Array.isArray(cloud.purchaseInvoices) && db.purchaseInvoices) {
      const localInvoices = await db.purchaseInvoices.toArray();
      const localInvoiceKeys = new Set(localInvoices.map(i => `${i.invoiceNo}_${i.supplierName}`));
      for (const ci of cloud.purchaseInvoices) {
        const key = `${ci.invoiceNo}_${ci.supplierName}`;
        if (!localInvoiceKeys.has(key)) {
          const { id, ...newInvoice } = ci;
          await db.purchaseInvoices.add(newInvoice);
        }
      }
    }

    // 7. Merge Supplier Payments
    if (Array.isArray(cloud.supplierPayments) && db.supplierPayments) {
      const localPayments = await db.supplierPayments.toArray();
      const localPaymentKeys = new Set(localPayments.map(p => `${p.supplierName}_${p.date}_${p.amount}_${p.createdAt}`));
      for (const cp of cloud.supplierPayments) {
        const key = `${cp.supplierName}_${cp.date}_${cp.amount}_${cp.createdAt}`;
        if (!localPaymentKeys.has(key)) {
          const { id, ...newPayment } = cp;
          await db.supplierPayments.add(newPayment);
        }
      }
    }

    return {
      merged: true,
      addedSales,
      addedProducts,
      updatedProducts,
      addedCustomers
    };
  }

  /**
   * Pull latest data from Google Drive Web App
   */
  async pullFromDrive() {
    if (!this.syncUrl) throw new Error('Google Drive Web URL tanımlanmamış!');

    const url = new URL(this.syncUrl);
    url.searchParams.set('marketId', this.marketId);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Google Drive yanıt vermedi (HTTP ${res.status})`);
    }

    const data = await res.json();
    if (data.empty) {
      return null; // Google Drive'da henüz dosya yok
    }

    return data;
  }

  /**
   * Push current dataset to Google Drive Web App
   */
  async pushToDrive(payload) {
    if (!this.syncUrl) throw new Error('Google Drive Web URL tanımlanmamış!');

    const bodyStr = JSON.stringify(payload);

    // Using text/plain avoids CORS preflight OPTIONS request
    const res = await fetch(this.syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: bodyStr
    });

    if (!res.ok) {
      throw new Error(`Google Drive yükleme hatası (HTTP ${res.status})`);
    }

    const resJson = await res.json();
    return resJson;
  }

  /**
   * Complete 2-Way Pull-Merge-Push Flow:
   * 1. Pull from Google Drive (if exists)
   * 2. Smart-merge cloud data into local Dexie
   * 3. Export fresh merged local dataset
   * 4. Push unified dataset back to Google Drive
   * Result: Both devices stay 100% unified with zero lost sales!
   */
  async fullSync() {
    if (!this.syncUrl) return { status: 'no_url' };
    if (this.isSyncing) {
      this.hasPendingPush = true;
      return { status: 'queued' };
    }

    this.isSyncing = true;
    this.status = 'syncing';
    this.lastError = null;
    this.notifyListeners();

    try {
      // Step 1: Pull cloud data
      const cloudData = await this.pullFromDrive();

      // Step 2: Merge locally
      let mergeResult = null;
      if (cloudData && !cloudData.empty) {
        mergeResult = await this.mergeCloudData(cloudData);
      }

      // Step 3: Export fresh merged local dataset
      const freshDataset = await this.exportDataset();

      // Step 4: Push to Google Drive
      const pushRes = await this.pushToDrive(freshDataset);
      if (pushRes?.serverTime) {
        this.lastCloudTimestamp = pushRes.serverTime;
      } else if (pushRes?.timestamp) {
        this.lastCloudTimestamp = new Date(pushRes.timestamp).getTime();
      } else {
        this.lastCloudTimestamp = 0;
      }

      this.status = 'success';
      this.lastSyncTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      await db.settings.put({ key: this.settingKey('gdrive_last_sync'), value: this.lastSyncTime });

      this.notifyListeners();
      return { success: true, mergeResult };
    } catch (err) {
      console.error('[GDrive Sync Error]:', err);
      this.status = 'error';
      this.lastError = err.message || 'Eşitleme hatası';
      this.notifyListeners();
      return { success: false, error: this.lastError };
    } finally {
      this.isSyncing = false;
      if (this.hasPendingPush) {
        this.hasPendingPush = false;
        setTimeout(() => this.fullSync(), 100);
      }
    }
  }

  /**
   * Share JSON directly via native Android Share sheet (to Google Drive app if installed)
   */
  async shareBackupFile() {
    const data = await this.exportDataset();
    const jsonStr = JSON.stringify(data, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `MarketKasa_Yedek_${dateStr}.json`;

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const file = new File([blob], fileName, { type: 'application/json' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: 'MarketKasa Yedek',
          text: 'Market Kasa Google Drive Yedeği',
          files: [file]
        });
        return true;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Share error, falling back to download:', err);
        }
      }
    }

    // Fallback: browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }
}

export const googleDriveSync = new GoogleDriveSyncManager();
