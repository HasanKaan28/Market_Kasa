import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { ShieldCheck, UserCheck, Lock, Delete, X, AlertCircle } from 'lucide-react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState(false);

  const users = useLiveQuery(() => db.users.toArray(), []);

  // Restore saved session or show login on start
  useEffect(() => {
    async function checkSession() {
      const savedUserId = localStorage.getItem('activeUserId');
      if (savedUserId) {
        const user = await db.users.get(parseInt(savedUserId));
        if (user) {
          setCurrentUser(user);
          return;
        }
      }
      // If no session, prompt login
      setShowPinModal(true);
    }
    checkSession();
  }, []);

  const handleSelectUser = (user) => {
    setSelectedUser(user);
    setEnteredPin('');
    setPinError(false);
  };

  const handleKeypadPress = (val) => {
    if (val === 'C') {
      setEnteredPin('');
      setPinError(false);
      return;
    }

    if (enteredPin.length < 4) {
      const nextPin = enteredPin + val;
      setEnteredPin(nextPin);
      setPinError(false);

      if (nextPin.length === 4) {
        // Validate PIN
        if (selectedUser && selectedUser.pin === nextPin) {
          setCurrentUser(selectedUser);
          localStorage.setItem('activeUserId', selectedUser.id.toString());
          setShowPinModal(false);
          setEnteredPin('');
          setSelectedUser(null);
        } else {
          setPinError(true);
          setTimeout(() => {
            setEnteredPin('');
            setPinError(false);
          }, 800);
        }
      }
    }
  };

  const logout = () => {
    localStorage.removeItem('activeUserId');
    setCurrentUser(null);
    setSelectedUser(null);
    setEnteredPin('');
    setShowPinModal(true);
  };

  const hasPermission = (permissionKey) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return !!currentUser.permissions?.[permissionKey];
  };

  return (
    <AuthContext.Provider value={{ currentUser, logout, hasPermission, openLogin: () => setShowPinModal(true) }}>
      {children}

      {/* PIN Login Screen Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 safe-top safe-bottom select-none animate-fade-in">
          <div className="w-full max-w-sm flex flex-col items-center space-y-4">
            
            {/* Logo & Header */}
            <div className="text-center space-y-1">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-lg shadow-emerald-500/10">
                <Lock className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-black text-white tracking-tight">Kullanıcı Girişi</h2>
              <p className="text-xs text-slate-400">Devam etmek için profilinizi ve 4 haneli PIN kodunuzu girin</p>
            </div>

            {/* User Profile Selector Cards */}
            <div className="w-full grid grid-cols-2 gap-2">
              {users?.map((u) => {
                const isSelected = selectedUser?.id === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className={`p-3 rounded-2xl border flex flex-col items-center text-center transition active:scale-95 ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-900/40 font-bold'
                        : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-800/80 flex items-center justify-center text-sm font-bold mb-1">
                      {u.role === 'admin' ? '👑' : '👤'}
                    </div>
                    <span className="text-xs font-bold truncate w-full">{u.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono mt-0.5 capitalize">
                      {u.role === 'admin' ? 'Müdür (Tam Yetki)' : 'Kasiyer'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* PIN Input Dots */}
            {selectedUser && (
              <div className="w-full flex flex-col items-center space-y-3 pt-2">
                <span className="text-xs text-slate-300 font-medium">
                  <b>{selectedUser.name}</b> için PIN Girin:
                </span>

                <div className="flex items-center gap-3">
                  {[0, 1, 2, 3].map((idx) => {
                    const isFilled = enteredPin.length > idx;
                    return (
                      <div
                        key={idx}
                        className={`w-4 h-4 rounded-full transition-all duration-150 ${
                          pinError
                            ? 'bg-rose-500 scale-110 animate-bounce'
                            : isFilled
                            ? 'bg-emerald-400 scale-110 shadow-[0_0_10px_#34d399]'
                            : 'bg-slate-800 border border-slate-700'
                        }`}
                      />
                    );
                  })}
                </div>

                {pinError && (
                  <span className="text-xs font-bold text-rose-400 animate-shake flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Hatalı PIN! Lütfen tekrar deneyin.
                  </span>
                )}

                {/* Touch Numpad */}
                <div className="grid grid-cols-3 gap-2 w-64 pt-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '←'].map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (key === '←') {
                          setEnteredPin(prev => prev.slice(0, -1));
                        } else {
                          handleKeypadPress(key);
                        }
                      }}
                      className={`h-13 rounded-2xl text-xl font-bold flex items-center justify-center active:scale-95 transition ${
                        key === 'C'
                          ? 'bg-rose-950/40 text-rose-400 border border-rose-800/40'
                          : key === '←'
                          ? 'bg-slate-800 text-slate-400 border border-slate-700'
                          : 'bg-slate-900 text-white border border-slate-800 hover:bg-slate-850'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {/* Helpful Hint */}
                <p className="text-[10px] text-slate-500 text-center font-mono pt-1">
                  Varsayılan PIN'ler: Müdür: <b>1234</b> | Kasiyer: <b>0000</b>
                </p>
              </div>
            )}

            {!selectedUser && (
              <p className="text-xs text-slate-500 italic pt-4">Lütfen giriş yapmak için yukarıdan bir profil seçin</p>
            )}

          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
