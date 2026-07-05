import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/navigationRef';

// Foreground presentation (keys cover both SDK 54 and SDK 56 handler shapes)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function getProjectId() {
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId || projectId === 'YOUR_EAS_PROJECT_ID') return null;
  return projectId;
}

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Daily updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1D9E75',
  });
  // Referenced by notifyIncident() for serious incidents
  await Notifications.setNotificationChannelAsync('urgent', {
    name: 'Urgent incident alerts',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 500, 250, 500],
    lightColor: '#E24B4A',
  });
}

/**
 * Registers this device for push notifications.
 * Returns the Expo push token string, or null if unavailable
 * (simulator, permission denied, or missing EAS projectId).
 */
export async function registerForPushNotificationsAsync() {
  await ensureAndroidChannels();

  if (!Device.isDevice) {
    console.log('Push disabled: not a physical device.');
    return null;
  }
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    console.log('Push disabled: permission not granted.');
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    console.warn('Push disabled: set extra.eas.projectId in app.json (run `eas init`).');
    return null;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  return token;
}

/**
 * Hook: registers the device token for this user and routes
 * notification taps. Mount once at the navigator root.
 */
export function usePushNotifications(userId) {
  const responseListener = useRef(null);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;

    (async () => {
      try {
        // Respect the soft-ask priming: only auto-register if the user
        // accepted priming OR the OS permission is already granted.
        const prime = await AsyncStorage.getItem('dailylog:push_prime');
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted' && prime !== 'accepted') return;

        const token = await registerForPushNotificationsAsync();
        if (!token || !mounted) return;
        const { error } = await supabase.from('push_tokens').upsert(
          {
            user_id: userId,
            token,
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
          },
          { onConflict: 'user_id,token' }
        );
        if (error) console.warn('Push token save failed:', error.message);
      } catch (err) {
        console.log('Push registration failed:', err.message);
      }
    })();

    // Route the user when they tap a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content?.data || {};
        if (data.type === 'announcement') {
          // Announcements screen exists in every role's stack
          navigate('Announcements');
        } else if (data.type === 'incident' || data.type === 'medication' || data.childId) {
          // Incident / medication / daily-log notifications land on the
          // parent home, where banners and the day view are shown.
          navigate('ParentTabs', { screen: 'ParentHome' });
        }
      }
    );

    return () => {
      mounted = false;
      responseListener.current?.remove();
    };
  }, [userId]);
}

async function sendExpoPush(messages) {
  if (!messages.length) return;
  // Expo push API accepts max 100 messages per request — chunk the fan-out
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
  }
}

/**
 * Broadcast an announcement push to all parents in the daycare
 * (or a single classroom when classroomId is provided).
 */
export async function notifyAnnouncement(daycareId, classroomId, title, body, announcementId) {
  try {
    const { data: tokens, error } = await supabase.rpc('get_announcement_push_tokens', {
      p_daycare_id: daycareId,
      p_classroom_id: classroomId || null,
    });
    if (error || !tokens?.length) return;
    const messages = tokens.map(({ token }) => ({
      to: token,
      sound: 'default',
      title: `📢 ${title}`,
      body: body?.length > 160 ? `${body.slice(0, 157)}...` : body,
      data: { type: 'announcement', announcementId },
      channelId: 'default',
    }));
    await sendExpoPush(messages);
  } catch (err) {
    console.log('Announcement push error:', err.message);
  }
}

export async function notifyParents(childId, childName, logDate) {
  try {
    const { data: tokens, error } = await supabase.rpc('get_parent_push_tokens', { p_child_id: childId });
    if (error || !tokens?.length) return;
    const messages = tokens.map(({ token }) => ({
      to: token,
      sound: 'default',
      title: `${childName}'s daily log is ready 📋`,
      body: `Tap to see how ${childName}'s day went at daycare.`,
      data: { childId, logDate },
      channelId: 'default',
    }));
    await sendExpoPush(messages);
  } catch (err) {
    console.log('Push notification error:', err.message);
  }
}

export async function notifyIncident(childId, childName, severity) {
  try {
    const { data: tokens, error } = await supabase.rpc('get_parent_push_tokens', { p_child_id: childId });
    if (error || !tokens?.length) return;

    const titles = {
      minor: `Minor incident reported for ${childName}`,
      moderate: `⚠️ ${childName} had an incident — please review`,
      serious: `🚨 URGENT: Serious incident reported for ${childName}`,
    };
    const bodies = {
      minor: `A small bump or scrape was reported. Tap to see details.`,
      moderate: `An incident requiring first aid was reported. Please review and acknowledge.`,
      serious: `A serious incident was reported. Please review immediately and contact the daycare.`,
    };

    const messages = tokens.map(({ token }) => ({
      to: token,
      sound: 'default',
      title: titles[severity] || titles.minor,
      body: bodies[severity] || bodies.minor,
      data: { childId, type: 'incident', severity },
      priority: severity === 'serious' ? 'high' : 'default',
      channelId: severity === 'serious' ? 'urgent' : 'default',
    }));
    await sendExpoPush(messages);
  } catch (err) {
    console.log('Incident push notification error:', err.message);
  }
}

/** Notify parents when a medication dose is administered to their child. */
export async function notifyMedicationGiven(childId, childName, medName) {
  try {
    const { data: tokens, error } = await supabase.rpc('get_parent_push_tokens', { p_child_id: childId });
    if (error || !tokens?.length) return;
    const messages = tokens.map(({ token }) => ({
      to: token,
      sound: 'default',
      title: `💊 Medication given to ${childName}`,
      body: `${medName} was administered. Tap to see the record.`,
      data: { childId, type: 'medication' },
      channelId: 'default',
    }));
    await sendExpoPush(messages);
  } catch (err) {
    console.log('Medication push error:', err.message);
  }
}

