import React, { useState } from 'react';
import { Users, Plus, Edit2, Trash2, Shield, UserCheck, Key, Check, X } from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { sync } from '../utils/sync';

export default function UserManagement() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // Form State
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState('cashier');
  const [permissions, setPermissions] = useState({
    canAccessPos: true,
    canApplyDiscount: false,
    canCancelSale: false,
    canAccessProducts: false,
    canEditProducts: false,
    canViewBuyPrice: false,
    canAccessCustomers: false,
    canManageDebt: false,
    canAccessReports: false,
    canAccessSettings: false,
    canManageUsers: false
  });

  const users = useLiveQuery(() => db.users.toArray(), []);

  const openNewModal = () => {
    setEditingUser(null);
    setName('');
    setPin('');
    setRole('cashier');
    setPermissions({
      canAccessPos: true,
      canApplyDiscount: false,
      canCancelSale: false,
      canAccessProducts: false,
      canEditProducts: false,
      canViewBuyPrice: false,
      canAccessCustomers: false,
      canManageDebt: false,
      canAccessReports: false,
      canAccessSettings: false,
      canManageUsers: false
    });
    setIsModalOpen(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setName(user.name);
    setPin(user.pin);
    setRole(user.role || 'cashier');
    setPermissions(user.permissions || {
      canAccessPos: true,
      canApplyDiscount: false,
      canCancelSale: false,
      canAccessProducts: false,
      canEditProducts: false,
      canViewBuyPrice: false,
      canAccessCustomers: false,
      canManageDebt: false,
      canAccessReports: false,
      canAccessSettings: false,
      canManageUsers: false
    });
    setIsModalOpen(true);
  };

  const handleTogglePermission = (key) => {
    setPermissions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    if (newRole === 'admin') {
      // Grant all permissions for admin
      setPermissions({
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
      });
    } else if (newRole === 'stock_clerk') {
      // Stock clerk permissions
      setPermissions({
        canAccessPos: false,
        canApplyDiscount: false,
        canCancelSale: false,
        canAccessProducts: true,
        canEditProducts: true,
        canViewBuyPrice: true,
        canAccessCustomers: false,
        canManageDebt: false,
        canAccessReports: false,
        canAccessSettings: false,
        canManageUsers: false
      });
    } else {
      // Cashier permissions
      setPermissions({
        canAccessPos: true,
        canApplyDiscount: false,
        canCancelSale: false,
        canAccessProducts: false,
        canEditProducts: false,
        canViewBuyPrice: false,
        canAccessCustomers: false,
        canManageDebt: false,
        canAccessReports: false,
        canAccessSettings: false,
        canManageUsers: false
      });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || pin.length !== 4) {
      alert('Lütfen kullanıcı adı ve 4 haneli PIN girin.');
      return;
    }

    const payload = {
      name: name.trim(),
      pin: pin.trim(),
      role,
      permissions
    };

    if (editingUser) {
      await db.users.update(editingUser.id, payload);
      sync.broadcast('USER_SAVED', { user: { id: editingUser.id, ...payload } });
    } else {
      const newId = await db.users.add(payload);
      sync.broadcast('USER_SAVED', { user: { id: newId, ...payload } });
    }

    setIsModalOpen(false);
  };

  const handleDelete = async (id, userName) => {
    if (users.length <= 1) {
      alert('Sistemde en az bir kullanıcı bulunmalıdır!');
      return;
    }
    if (confirm(`"${userName}" kullanıcısını silmek istediğinize emin misiniz?`)) {
      await db.users.delete(id);
      sync.broadcast('USER_DELETED', { id });
    }
  };

  const permissionLabels = [
    { key: 'canAccessPos', label: 'Kasa Satış Ekranı', group: 'Satış' },
    { key: 'canApplyDiscount', label: 'Sepet İndirimi Yapabilme', group: 'Satış' },
    { key: 'canCancelSale', label: 'Fiş İptal / İade Edebilme', group: 'Satış' },
    { key: 'canAccessProducts', label: 'Ürün & Stok Menüsü', group: 'Stok' },
    { key: 'canEditProducts', label: 'Ürün Ekleme / Düzenleme', group: 'Stok' },
    { key: 'canViewBuyPrice', label: 'Alış Fiyatlarını (Maliyet) Görebilme', group: 'Stok' },
    { key: 'canAccessCustomers', label: 'Veresiye Defteri (Müşteriler)', group: 'Cari' },
    { key: 'canManageDebt', label: 'Tahsilat Alma / Borç Ekleme', group: 'Cari' },
    { key: 'canAccessReports', label: 'Kasa & Z-Raporları (Ciro / Kâr)', group: 'Rapor' },
    { key: 'canAccessSettings', label: 'Sistem Ayarları & Yedekleme', group: 'Yönetim' },
    { key: 'canManageUsers', label: 'Kullanıcı & Yetki Yönetimi', group: 'Yönetim' },
  ];

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-950 overflow-hidden">
      
      {/* Header */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <span>Kullanıcı & Yetki Yönetimi</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Personel profilleri ve ekran erişim izinleri</p>
        </div>

        <button
          onClick={openNewModal}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Kullanıcı Ekle</span>
        </button>
      </div>

      {/* Users List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {users?.map((u) => (
          <div
            key={u.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-lg">
                {u.role === 'admin' ? '👑' : '👤'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{u.name}</h4>
                  <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold uppercase ${
                    u.role === 'admin' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'
                  }`}>
                    {u.role === 'admin' ? 'Müdür (Admin)' : 'Kasiyer'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Giriş PIN: <span className="font-bold text-emerald-400">••••</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => openEditModal(u)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                title="Yetkileri Düzenle"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              {u.role !== 'admin' && (
                <button
                  onClick={() => handleDelete(u.id, u.name)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition"
                  title="Kullanıcıyı Sil"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom animate-fade-in">
          <form onSubmit={handleSave} className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">
                {editingUser ? 'Kullanıcı Yetkilerini Düzenle' : 'Yeni Personel Profili'}
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="p-1 rounded-full bg-slate-800 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* User Name & PIN */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Ad Soyad *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Örn: Ahmet Kasiyer"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">4 Haneli PIN *</label>
                  <input
                    type="password"
                    maxLength={4}
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Örn: 2026"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono text-center font-bold tracking-widest focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Role Preset */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">Rol Şablonu</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'admin', label: '👑 Müdür' },
                    { id: 'cashier', label: '👤 Kasiyer' },
                    { id: 'stock_clerk', label: '📦 Reyon' }
                  ].map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleRoleChange(r.id)}
                      className={`py-2 rounded-xl text-xs font-bold transition border ${
                        role === r.id
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Granular Permission Matrix */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Erişim ve İşlem Yetkileri:
                </label>
                <div className="space-y-1.5 bg-slate-950 p-2.5 rounded-2xl border border-slate-800">
                  {permissionLabels.map((perm) => {
                    const isChecked = !!permissions[perm.key];
                    return (
                      <label
                        key={perm.key}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-900 cursor-pointer transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-slate-800 text-slate-400 font-mono px-1.5 py-0.2 rounded">
                            {perm.group}
                          </span>
                          <span className="text-xs text-white font-medium">{perm.label}</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleTogglePermission(perm.key)}
                          className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex-1 bg-slate-800 text-slate-300 py-2.5 rounded-xl text-xs font-bold"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition"
              >
                {editingUser ? 'Güncelle' : 'Kullanıcıyı Kaydet'}
              </button>
            </div>

          </form>
        </div>
      )}

    </div>
  );
}
