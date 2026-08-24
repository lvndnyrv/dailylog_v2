import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { extractNotificationDestination } from '../lib/authLinks';
import { openNotificationRoute } from '../lib/notificationRoutes';
import { markNotificationPayloadRead } from './useParentNotifications';

let notificationsPromise = null;

export const PUSH_PRIME_KEY = 'dailylog:push_prime';

export function pushPrimeKeyForUser(userId) {
  return userId ? `${PUSH_PRIME_KEY}:${userId}` : PUSH_PRIME_KEY;
}

export async function getPushPrimeChoice(userId) {
  const userKey = pushPrimeKeyForUser(userId);
  const userChoice = await AsyncStorage.getItem(userKey);
  if (userChoice) return userChoice;

  // Migrate the previous device-global choice to the currently signed-in
  // account, then remove it so a second account still receives its own ask.
  if (userId) {
    const legacyChoice = await AsyncStorage.getItem(PUSH_PRIME_KEY);
    if (legacyChoice) {
      await AsyncStorage.multiSet([[userKey, legacyChoice]]);
      await AsyncStorage.removeItem(PUSH_PRIME_KEY);
      return legacyChoice;
    }
  }

  return null;
}

export async function setPushPrimeChoice(userId, choice) {
  await AsyncStorage.setItem(pushPrimeKeyForUser(userId), choice);
}

function remotePushUnavailable() {
  // Expo SDK 56 intentionally removes Android remote-push support from
  // Expo Go. Avoid evaluating expo-notifications there; development and
  // release builds still load the native module normally.
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

async function loadNotifications() {
  if (remotePushUnavailable()) return null;
  if (!notificationsPromise) {
    notificationsPromise = import('expo-notifications').then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      return Notifications;
    });
  }
  return notificationsPromise;
}

function getProjectId() {
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId || projectId === 'YOUR_EAS_PROJECT_ID') return null;
  return projectId;
}

async function ensureAndroidChannels(Notifications) {
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

function normalizedPermissionStatus(Notifications, settings) {
  if (Platform.OS !== 'ios') return settings?.status || 'undetermined';

  const authorizationStatus = settings?.ios?.status;
  if (authorizationStatus == null) return settings?.status || 'undetermined';

  if (
    authorizationStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    authorizationStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    authorizationStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }
  if (authorizationStatus === Notifications.IosAuthorizationStatus.DENIED) {
    return 'denied';
  }
  return 'undetermined';
}

/**
 * Registers this device for push notifications.
 * Returns the Expo push token string, or null if unavailable
 * (permission denied or missing EAS projectId).
 */
export async function registerForPushNotificationsAsync() {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  await ensureAndroidChannels(Notifications);

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  let permission = await Notifications.getPermissionsAsync();
  let status = normalizedPermissionStatus(Notifications, permission);
  if (status !== 'granted') {
    permission = await Notifications.requestPermissionsAsync();
    status = normalizedPermissionStatus(Notifications, permission);
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

export async function getPushPermissionStatus() {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unavailable';
  const settings = await Notifications.getPermissionsAsync();
  return normalizedPermissionStatus(Notifications, settings);
}

/**
 * Hook: registers the device token for this user and routes
 * notification taps. Mount once at the navigator root.
 */
export function usePushNotifications(userId, role) {
  const handledResponses = useRef(new Set());

  useEffect(() => {
    if (!userId || !role) return undefined;
    let active = true;

    function openBusinessUrl(url) {
      const destination = extractNotificationDestination(url);
      if (!destination || !active) return;
      setTimeout(() => {
        if (active) {
          openNotificationRoute(destination, role);
          markNotificationPayloadRead(destination).catch(() => {});
        }
      }, 0);
    }

    Linking.getInitialURL().then(openBusinessUrl).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => {
      openBusinessUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [role, userId]);

  useEffect(() => {
    if (!userId || !role || remotePushUnavailable()) return undefined;
    let mounted = true;
    let responseSubscription = null;

    (async () => {
      try {
        const Notifications = await loadNotifications();
        if (!Notifications || !mounted) return;

        const handleResponse = (response) => {
          const identifier = response?.notification?.request?.identifier
            || response?.notification?.date
            || JSON.stringify(response?.notification?.request?.content?.data || {});
          if (handledResponses.current.has(identifier)) return;
          handledResponses.current.add(identifier);
          const data = response?.notification?.request?.content?.data || {};
          openNotificationRoute(data, role);
          markNotificationPayloadRead(data).catch(() => {});
        };

        // Install the response listener independently of permission/token
        // registration. A cold-start tap must still route correctly while the
        // OS permission is denied, a token is rotating, or EAS is unavailable.
        responseSubscription = Notifications.addNotificationResponseReceivedListener(
          handleResponse
        );
        const initialResponse = await Notifications.getLastNotificationResponseAsync();
        if (initialResponse && mounted) {
          handleResponse(initialResponse);
          await Notifications.clearLastNotificationResponseAsync();
        }

        // Respect the soft-ask priming: only auto-register if the user
        // accepted priming OR the OS permission is already granted.
        const prime = await getPushPrimeChoice(userId);
        const permission = await Notifications.getPermissionsAsync();
        const status = normalizedPermissionStatus(Notifications, permission);
        if (status === 'denied') return;
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

    return () => {
      mounted = false;
      responseSubscription?.remove();
    };
  }, [role, userId]);
}

/**
 * Enqueue an announcement for server-side fan-out. The client never receives
 * another user's token and never talks to a delivery provider directly.
 */
export async function notifyAnnouncement(daycareId, classroomId, title, body, announcementId) {
  try {
    const { error } = await supabase.rpc('enqueue_center_notification', {
      p_daycare_id: daycareId,
      p_classroom_id: classroomId || null,
      p_kind: 'announcement',
      p_title: `📢 ${title}`,
      p_body: body?.length > 160 ? `${body.slice(0, 157)}...` : body,
      p_payload: { type: 'announcement', announcementId, channelId: 'default' },
      p_dedupe_key: `announcement:${announcementId}`,
      p_channels: ['push'],
    });
    if (error) console.log('Announcement enqueue error:', error.message);
  } catch (err) {
    console.log('Announcement enqueue error:', err.message);
  }
}

export async function notifyParents(childId, childName, logDate) {
  try {
    const { error } = await supabase.rpc('enqueue_child_notification', {
      p_child_id: childId,
      p_kind: 'daily_log',
      p_title: `${childName}'s daily log is ready 📋`,
      p_body: `Tap to see how ${childName}'s day went at daycare.`,
      p_payload: { childId, logDate, type: 'daily_log', channelId: 'default' },
      p_dedupe_key: `daily-log:${childId}:${logDate}`,
      p_channels: ['push'],
    });
    if (error) console.log('Daily log enqueue error:', error.message);
  } catch (err) {
    console.log('Daily log enqueue error:', err.message);
  }
}

export async function notifyIncident(childId, childName, severity) {
  try {
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

    const { error } = await supabase.rpc('enqueue_child_notification', {
      p_child_id: childId,
      p_kind: 'incident',
      p_title: titles[severity] || titles.minor,
      p_body: bodies[severity] || bodies.minor,
      p_payload: {
        childId,
        type: 'incident',
        severity,
        priority: severity === 'serious' ? 'high' : 'default',
        channelId: severity === 'serious' ? 'urgent' : 'default',
      },
      p_dedupe_key: null,
      p_channels: ['push'],
    });
    if (error) console.log('Incident enqueue error:', error.message);
  } catch (err) {
    console.log('Incident enqueue error:', err.message);
  }
}

/** Notify parents when a medication dose is administered to their child. */
export async function notifyMedicationGiven(childId, childName, medName) {
  try {
    const { error } = await supabase.rpc('enqueue_child_notification', {
      p_child_id: childId,
      p_kind: 'medication',
      p_title: `💊 Medication given to ${childName}`,
      p_body: `${medName} was administered. Tap to see the record.`,
      p_payload: { childId, type: 'medication', channelId: 'default' },
      p_dedupe_key: null,
      p_channels: ['push'],
    });
    if (error) console.log('Medication enqueue error:', error.message);
  } catch (err) {
    console.log('Medication enqueue error:', err.message);
  }
}
