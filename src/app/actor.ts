import type { Actor } from '@/data/audit';
import { useData } from './appData';
import { useMarketSettings } from './marketSettings';
import { useSession } from './session';

/** Who acts from this screen, for the audit log: this register and the person signed in. */
export function useActor(): Actor {
  const { settings } = useData();
  const { staff } = useSession();
  const { cutoffMinutes } = useMarketSettings();
  return {
    deviceCode: settings.deviceCode,
    cutoffMinutes,
    ...(staff ? { staffId: staff.id } : {}),
  };
}
