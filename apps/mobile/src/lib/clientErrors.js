import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { supabase } from './supabase';

function safeReference(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return cleaned || null;
}

export async function reportClientError(errorCode, frameworkReference = null) {
  const { data, error } = await supabase.rpc('report_client_error', {
    p_surface: Platform.OS === 'android' ? 'mobile_android' : 'mobile_ios',
    p_error_code: errorCode,
    p_app_version: Constants.expoConfig?.version || null,
    p_release_channel: Updates.channel || (__DEV__ ? 'development' : null),
    p_framework_reference: safeReference(frameworkReference),
  });

  if (error || !data) return null;
  return String(data).slice(0, 8).toUpperCase();
}
