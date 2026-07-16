import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import type { Database } from './types.gen';

// React Native / Expo client. Storage (AsyncStorage) is injected by the app so
// this package has no react-native dependency.
export function createNativeSupabase(
  url: string,
  anonKey: string,
  storage: NonNullable<SupabaseClientOptions<'public'>['auth']>['storage'],
) {
  return createClient<Database>(url, anonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export type NativeSupabase = ReturnType<typeof createNativeSupabase>;
