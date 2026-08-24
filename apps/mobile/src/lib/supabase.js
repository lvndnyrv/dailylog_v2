import { createNativeSupabase } from '@dailylog/db/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing mobile Supabase configuration. Copy apps/mobile/.env.example to ' +
    'apps/mobile/.env.local and set EXPO_PUBLIC_SUPABASE_URL and ' +
    'EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createNativeSupabase(SUPABASE_URL, SUPABASE_ANON_KEY, AsyncStorage);
