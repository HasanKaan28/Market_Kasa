import { useLiveQuery } from 'dexie-react-hooks';
import { loadMarketSettings, type MarketSettings } from '@/data/settings';
import { useData } from './appData';

const UNTIL_LOADED: MarketSettings = { cutoffMinutes: 0 };

/** The market's settings as they stand, following a change made here or on another register. */
export function useMarketSettings(): MarketSettings {
  const { db } = useData();
  return useLiveQuery(() => loadMarketSettings(db), [db]) ?? UNTIL_LOADED;
}
