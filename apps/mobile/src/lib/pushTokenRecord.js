import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export function pushTokenRecord(userId, token) {
  return {
    user_id: userId,
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    last_seen_at: new Date().toISOString(),
    device_model: Device.modelName || null,
    app_version: Constants.expoConfig?.version || null,
    is_physical: Device.isDevice,
  };
}

