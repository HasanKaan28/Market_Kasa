import { db } from '../db/db';

class SyncManager {
  constructor() {
    this.marketId = null;
    this.ws = null;
    this.isConnected = false;
    this.connectedDevices = 1;
    this.listeners = new Set();
    this.reconnectTimer = null;
  }

  async init(marketId) {
    this.marketId = marketId || null;
    // Get custom server URL if configured
    let serverUrl = 'ws://192.168.1.103:5174';
    try {
      const setting = await db.settings.get('syncServerUrl');
      if (setting?.value) {
        serverUrl = setting.value;
      } else if (window.location.hostname) {
        serverUrl = `ws://${window.location.hostname}:5174`;
      }
    } catch (e) {
      // ignore
    }

    this.connect(serverUrl, marketId);
  }

  connect(url, marketId) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyListeners();
        console.log('[SYNC] Sunucuya canlı bağlandı:', url);
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleIncomingMessage(msg);
        } catch (err) {
          console.error('[SYNC] Gelen mesaj hatası:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.connectedDevices = 1;
        this.notifyListeners();
        // Try reconnecting after 3 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connect(url);
        }, 3000);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.notifyListeners();
      };
    } catch (err) {
      console.warn('[SYNC] WebSocket bağlantı hatası:', err);
    }
  }

  async handleIncomingMessage(msg) {
    if (msg.marketId && msg.marketId !== this.marketId) return;
    if (msg.type === 'DEVICE_COUNT') {
      this.connectedDevices = msg.count || 1;
      this.notifyListeners();
      return;
    }

    const { action, payload } = msg;
    if (!action) return;

    console.log('[SYNC] Başka cihazdan güncelleme alındı:', action);

    switch (action) {
      case 'SALE_COMPLETED':
        if (payload.sale) {
          const existing = await db.sales.where('receiptNo').equals(payload.sale.receiptNo).first();
          if (!existing) {
            await db.sales.add(payload.sale);
          }
        }
        // Deduct product stocks
        if (payload.items) {
          for (const item of payload.items) {
            const prod = await db.products.get(item.id);
            if (prod) {
              await db.products.update(prod.id, {
                stock: Math.max(0, prod.stock - item.quantity)
              });
            }
          }
        }
        // Update customer balance if debt
        if (payload.customerId && payload.grandTotal) {
          const cust = await db.customers.get(payload.customerId);
          if (cust) {
            await db.customers.update(cust.id, {
              balance: (cust.balance || 0) + payload.grandTotal
            });
          }
        }
        break;

      case 'PRODUCT_SAVED':
        if (payload.product) {
          const existing = await db.products.where('barcode').equals(payload.product.barcode).first();
          if (existing) {
            await db.products.update(existing.id, payload.product);
          } else {
            await db.products.add(payload.product);
          }
        }
        break;

      case 'PRODUCT_DELETED':
        if (payload.id) {
          await db.products.delete(payload.id);
        }
        break;

      case 'STOCK_ADJUSTED':
        if (payload.id && payload.delta !== undefined) {
          const prod = await db.products.get(payload.id);
          if (prod) {
            await db.products.update(payload.id, {
              stock: Math.max(0, prod.stock + payload.delta)
            });
          }
        }
        break;

      case 'CUSTOMER_SAVED':
        if (payload.customer) {
          if (payload.customer.id) {
            await db.customers.put(payload.customer);
          } else {
            await db.customers.add(payload.customer);
          }
        }
        break;

      case 'CUSTOMER_BALANCE_UPDATED':
        if (payload.customerId) {
          await db.customers.update(payload.customerId, {
            balance: payload.newBalance
          });
          if (payload.transaction) {
            await db.customerTransactions.add(payload.transaction);
          }
        }
        break;

      case 'USER_SAVED':
        if (payload.user) {
          if (payload.user.id) {
            await db.users.put(payload.user);
          } else {
            await db.users.add(payload.user);
          }
        }
        break;

      case 'USER_DELETED':
        if (payload.id) {
          await db.users.delete(payload.id);
        }
        break;

      default:
        break;
    }
  }

  broadcast(action, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ action, marketId: this.marketId, payload }));
      } catch (err) {
        console.warn('[SYNC] Yayınlama hatası:', err);
      }
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback({
      isConnected: this.isConnected,
      connectedDevices: this.connectedDevices
    });
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => {
      cb({
        isConnected: this.isConnected,
        connectedDevices: this.connectedDevices
      });
    });
  }
}

export const sync = new SyncManager();
