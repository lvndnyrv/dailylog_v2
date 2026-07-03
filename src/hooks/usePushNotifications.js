import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export function usePushNotifications(userId) {
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    if (!userId) return;
    setupNotifications(userId);
  }, [userId]);
}

async function setupNotifications(userId) {
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (err) {
    console.log('Push notifications not available:', err.message);
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
    }));
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.log('Push notification error:', err.message);
  }
}