/**
 * Staff Leaderboard & Competition Stats Calculation Engine
 * Calculates sales performance, ranking, revenue contribution and badges for each staff member.
 */

export function calculateStaffLeaderboard(sales = [], users = [], period = 'today') {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);
  const weekStart = todayStart - (7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // 1. Filter sales by selected time period
  const completedSales = sales.filter(s => {
    if (s.status === 'cancelled') return false;
    const saleTime = new Date(s.date).getTime();
    if (period === 'today') return saleTime >= todayStart;
    if (period === 'yesterday') return saleTime >= yesterdayStart && saleTime < todayStart;
    if (period === 'week') return saleTime >= weekStart;
    if (period === 'month') return saleTime >= monthStart;
    return true; // 'all'
  });

  const totalStoreRevenue = completedSales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const totalStoreSalesCount = completedSales.length;

  // 2. Map of all registered users
  const staffMap = {};
  users.forEach(u => {
    staffMap[u.id] = {
      id: u.id,
      name: u.name,
      role: u.role,
      salesCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      totalItemsSold: 0,
      avgBasket: 0,
      revenueShare: 0,
      badges: []
    };
  });

  // Fallback bucket for legacy sales without a registered sellerId
  const legacyCashierId = 'user_kasiyer';
  if (!staffMap[legacyCashierId]) {
    staffMap[legacyCashierId] = {
      id: legacyCashierId,
      name: 'Kasiyer',
      role: 'cashier',
      salesCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      totalItemsSold: 0,
      avgBasket: 0,
      revenueShare: 0,
      badges: []
    };
  }

  // 3. Aggregate sales by seller
  completedSales.forEach(sale => {
    let sellerId = sale.sellerId;
    let sellerName = sale.sellerName;

    // If sellerId doesn't match an existing user, try matching by name
    if (!sellerId || !staffMap[sellerId]) {
      const matchByName = users.find(u => u.name && sellerName && u.name.toLowerCase() === sellerName.toLowerCase());
      if (matchByName) {
        sellerId = matchByName.id;
      } else {
        sellerId = legacyCashierId;
      }
    }

    if (!staffMap[sellerId]) {
      staffMap[sellerId] = {
        id: sellerId,
        name: sellerName || 'Kasiyer',
        role: 'cashier',
        salesCount: 0,
        totalRevenue: 0,
        totalProfit: 0,
        totalItemsSold: 0,
        avgBasket: 0,
        revenueShare: 0,
        badges: []
      };
    }

    const s = staffMap[sellerId];
    s.salesCount += 1;
    s.totalRevenue += (sale.grandTotal || 0);
    s.totalProfit += (sale.profit || 0);

    const itemsCount = Array.isArray(sale.items)
      ? sale.items.reduce((sum, it) => sum + (it.quantity || 1), 0)
      : 0;
    s.totalItemsSold += itemsCount;
  });

  // 4. Calculate averages, percentages, and performance badges
  const leaderboard = Object.values(staffMap).map(staff => {
    const avgBasket = staff.salesCount > 0 ? staff.totalRevenue / staff.salesCount : 0;
    const revenueShare = totalStoreRevenue > 0 ? (staff.totalRevenue / totalStoreRevenue) * 100 : 0;

    const badges = [];
    if (staff.totalRevenue >= 1000) badges.push({ label: 'Ciro Canavarı', icon: '🚀', color: 'text-amber-400' });
    if (staff.salesCount >= 10) badges.push({ label: 'Hızlı Kasiyer', icon: '⚡', color: 'text-sky-400' });
    if (avgBasket >= 200) badges.push({ label: 'Sepet Ustası', icon: '🎯', color: 'text-emerald-400' });
    if (staff.totalProfit >= 500) badges.push({ label: 'Kâr Lideri', icon: '💎', color: 'text-purple-400' });

    return {
      ...staff,
      avgBasket,
      revenueShare,
      badges
    };
  });

  // 5. Sort by Total Revenue (descending), then by sales count
  leaderboard.sort((a, b) => b.totalRevenue - a.totalRevenue || b.salesCount - a.salesCount);

  // 6. Assign Ranks and Top Badges
  leaderboard.forEach((staff, index) => {
    staff.rank = index + 1;
    if (index === 0 && staff.totalRevenue > 0) {
      staff.badges.unshift({ label: 'Şampiyon', icon: '👑', color: 'text-yellow-400 font-bold' });
    }
  });

  return {
    leaderboard,
    totalStoreRevenue,
    totalStoreSalesCount,
    topSeller: leaderboard.length > 0 && leaderboard[0].totalRevenue > 0 ? leaderboard[0] : null
  };
}
