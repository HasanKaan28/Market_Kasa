import { useLiveQuery } from 'dexie-react-hooks';
import {
  DEFAULT_IDLE_LOCK_MINUTES,
  DEFAULT_NEW_CUSTOMER_LIMIT,
  loadMarketSettings,
  type MarketSettings,
} from '@/data/settings';
import { DEFAULT_SCALE } from '@/domain/scaleBarcode';
import { useData } from './appData';

const UNTIL_LOADED: MarketSettings = {
  cutoffMinutes: 0,
  scale: DEFAULT_SCALE,
  newCustomerLimit: DEFAULT_NEW_CUSTOMER_LIMIT,
  idleLockMinutes: DEFAULT_IDLE_LOCK_MINUTES,
  requirePin: false,
};

/** The market's settings as they stand, following a change made here or on another register. */
export function useMarketSettings(): MarketSettings {
  const { db } = useData();
  return useLiveQuery(() => loadMarketSettings(db), [db]) ?? UNTIL_LOADED;
}
