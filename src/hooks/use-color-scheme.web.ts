import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const emptySubscribe = () => () => {};

/**
 * To support static rendering, the value must be re-calculated on the client:
 * the server (and the hydration pass) report 'unspecified', and the system
 * value takes over once hydrated. `useSyncExternalStore` supplies the
 * hydration flag without a setState-in-effect, which `react-hooks/set-state-in-effect`
 * rejects.
 */
export function useColorScheme(): 'light' | 'dark' | 'unspecified' {
  const systemScheme = useRNColorScheme();
  const hasHydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  if (!hasHydrated) return 'unspecified';
  return systemScheme ?? 'unspecified';
}
