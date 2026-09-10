import confetti from 'canvas-confetti';
import { db } from '../db/db';
import { playMilestoneChime } from './sound';

/**
 * Revenue Target & Milestone Alert Service
 */

export async function checkAndTriggerRevenueNotification(currentRevenue = 0) {
  try {
    const enabledSetting = await db.settings.get('daily_revenue_notify_enabled');
    const isEnabled = enabledSetting ? enabledSetting.value !== 'false' && enabledSetting.value !== false : true;
    if (!isEnabled) return false;

    const targetSetting = await db.settings.get('daily_revenue_target');
    const target = targetSetting ? parseFloat(targetSetting.value) || 10000 : 10000;

    if (currentRevenue < target) return false;

    const todayStr = new Date().toISOString().slice(0, 10);
    const lastNotified = await db.settings.get('daily_revenue_last_notified_date');

    // Only fire once per day
    if (lastNotified?.value === todayStr) {
      return false;
    }

    // Save that we notified for today
    await db.settings.put({ key: 'daily_revenue_last_notified_date', value: todayStr });

    // Fire celebration
    await triggerCelebration(target, currentRevenue);
    return true;
  } catch (err) {
    console.warn('Check revenue target error:', err);
    return false;
  }
}

export async function triggerCelebration(target = 10000, currentRevenue = 10000) {
  // 1. Play musical chime
  playMilestoneChime();

  // 2. Explode confetti
  try {
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.6 }
    });
    setTimeout(() => {
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      });
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      });
    }, 250);
  } catch (e) {
    console.warn('Confetti error:', e);
  }

  // 3. System / Browser notification
  const title = '🎉 Günlük Ciro Hedefine Ulaşıldı!';
  const body = `Tebrikler! Belirlediğiniz ₺${target.toLocaleString('tr-TR')} ciro hedefi aşıldı! Güncel Ciro: ₺${currentRevenue.toLocaleString('tr-TR')}`;

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          vibrate: [200, 100, 200]
        });
      } catch (err) {
        console.warn('Notification constructor error:', err);
      }
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          try {
            new Notification(title, { body, icon: '/favicon.ico' });
          } catch (e) {}
        }
      });
    }
  }

  // 4. Dispatch in-app UI celebration event
  window.dispatchEvent(
    new CustomEvent('DAILY_REVENUE_TARGET_REACHED', {
      detail: { target, currentRevenue }
    })
  );
}

export async function requestNotificationPermission() {
  if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return false;
}

export async function testRevenueNotification(target = 10000, currentRevenue = 12500) {
  await triggerCelebration(target, currentRevenue);
}

export function shareTargetAchievedViaWhatsApp(target = 10000, currentRevenue = 10000, storeName = 'KURŞUNLU MARKET') {
  const dateStr = new Date().toLocaleDateString('tr-TR');
  const timeStr = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const text = `🎉 *TEBRİKLER! GÜNLÜK CİRO HEDEFİ AŞILDI* 🎉\n\n🏪 *Mağaza:* ${storeName}\n📅 *Tarih:* ${dateStr} (${timeStr})\n🎯 *Belirlenen Hedef:* ₺${target.toLocaleString('tr-TR')}\n💰 *Ulaşılan Güncel Ciro:* ₺${currentRevenue.toLocaleString('tr-TR')}\n\nEmeği geçen tüm çalışma arkadaşlarımıza teşekkür eder, bereketli kazançlar dileriz! 🚀✨`;
  
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}
