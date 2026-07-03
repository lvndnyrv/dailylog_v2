import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://gskikhnfgikldhshskmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdza2lraG5mZ2lrbGRoc2hza21uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NzE1NzksImV4cCI6MjA5ODM0NzU3OX0.W02bt_nE8YdZoFEdD5SMhyb-a9ne9bhYZjOKbjs_5G4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});