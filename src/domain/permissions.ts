export type Role = 'cashier' | 'stock' | 'manager' | 'owner';

export const ROLES: readonly Role[] = ['cashier', 'stock', 'manager', 'owner'];

export const ROLE_LABELS: Record<Role, string> = {
  cashier: 'Kasiyer',
  stock: 'Stok',
  manager: 'Yönetici',
  owner: 'Sahip',
};

/** What a person may do, one key per row of DESIGN §8.5. */
export const PERMISSIONS = [
  'sell',
  'creditSale',
  'overLimit',
  'discount',
  'returnWithReceipt',
  'voidSale',
  'collect',
  'addProduct',
  'editProducts',
  'seeCost',
  'stock',
  'suppliers',
  'reports',
  'closeDay',
  'invoice',
  'admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  sell: 'Satış, bekletme',
  creditSale: 'Veresiye satış (limit içinde)',
  overLimit: 'Limit aşımı onayı',
  discount: 'İndirim',
  returnWithReceipt: 'Fişli iade',
  voidSale: 'Fişsiz iade, satış iptali',
  collect: 'Tahsilat',
  addProduct: 'Kasada yeni ürün ekleme',
  editProducts: 'Ürün düzenleme, fiyat değiştirme',
  seeCost: 'Alış fiyatı ve kârı görme',
  stock: 'Mal kabul, sayım',
  suppliers: 'Tedarikçi işlemleri',
  reports: 'Raporlar',
  closeDay: 'Gün sonu (Z)',
  invoice: 'Fatura kesme',
  admin: 'Personel, cihaz, ayar, dışa aktarma',
};

const CASHIER: readonly Permission[] = [
  'sell',
  'creditSale',
  'returnWithReceipt',
  'collect',
  'addProduct',
  'closeDay',
  'invoice',
];
const STOCK: readonly Permission[] = [
  'addProduct',
  'editProducts',
  'seeCost',
  'stock',
  'suppliers',
];

/** Each role's permissions by default (DESIGN §8.5). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  cashier: CASHIER,
  stock: STOCK,
  manager: PERMISSIONS.filter((permission) => permission !== 'admin'),
  owner: PERMISSIONS,
};

/** A person as far as permissions go: a role, and what is turned on or off for them alone. */
export type Grantee = { role: Role; permissions?: Partial<Record<Permission, boolean>> };

/**
 * Whether a person may do something: their own setting when they have one, else their role's.
 * The owner may do everything, so a market can never lock itself out of its own settings, and
 * only an owner may do what `admin` covers (DESIGN §8.3 asks for the owner). A role this build
 * does not know, as from a newer device, may do nothing.
 */
export function can(person: Grantee, permission: Permission): boolean {
  if (person.role === 'owner') {
    return true;
  }
  const defaults = ROLE_PERMISSIONS[person.role] as readonly Permission[] | undefined;
  if (permission === 'admin' || defaults === undefined) {
    return false;
  }
  return person.permissions?.[permission] ?? defaults.includes(permission);
}
