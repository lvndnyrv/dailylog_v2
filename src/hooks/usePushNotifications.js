import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
        // Incident + daily-log notifications land on the parent home,
        // where the incident banner / day view is shown.
        if (data.type === 'incident' || data.childId) {
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
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
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
