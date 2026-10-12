import { Platform } from 'react-native';
import { requestCalendarPermissions } from 'expo-calendar';
import * as LegacyCalendar from 'expo-calendar/legacy';

/**
 * Opens the platform calendar's event editor with the supplied event prefilled.
 *
 * Android's system event intent does not need direct calendar database access.
 * On iOS 16 the native event editor requires calendar authorization, while iOS
 * 17+ can use the narrower write-only permission.
 */
export async function presentCalendarEvent(event) {
  if (!(await LegacyCalendar.isAvailableAsync())) {
    throw new Error('A calendar app is not available on this device.');
  }

  if (Platform.OS === 'ios') {
    const permission = await requestCalendarPermissions(true);
    if (permission.status !== 'granted') {
      throw new Error('Calendar access is needed to add this event. You can allow it in Settings.');
    }
  }

  return LegacyCalendar.createEventInCalendarAsync(event);
}
