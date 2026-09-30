import { useQuery } from '@/db/hooks';
import { DEFAULT_SETTINGS, getSettings, type AppSettings } from '@/services/settings';

export function useSettings(): AppSettings {
  const { data } = useQuery((db) => getSettings(db), []);
  return data ?? DEFAULT_SETTINGS;
}
