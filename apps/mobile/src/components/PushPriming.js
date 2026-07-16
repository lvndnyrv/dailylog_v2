import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { registerForPushNotificationsAsync } from '../hooks/usePushNotifications';
import { Button } from './ui';
import { colors, spacing, radius } from '../theme';

export const PUSH_PRIME_KEY = 'dailylog:push_prime';

/**
 * Soft-ask priming screen shown once after login, BEFORE the OS
 * permission dialog. Industry standard: explain the value first,
 * so users don't reflexively tap "Don't allow".
 */
export function PushPrimingModal() {
  const { user, profile } = useAuth();
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    async function check() {
      if (!user || !profile) return;
      const answered = await AsyncStorage.getItem(PUSH_PRIME_KEY);
      if (answered) return; // already asked
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        // OS permission already granted — no need to prime
        await AsyncStorage.setItem(PUSH_PRIME_KEY, 'accepted');
        return;
      }
      setVisible(true);
    }
    check();
  }, [user?.id, profile?.id]);

  async function handleEnable() {
    setEnabling(true);
    await AsyncStorage.setItem(PUSH_PRIME_KEY, 'accepted');
    try {
      const token = await registerForPushNotificationsAsync();
      if (token && user) {
        await supabase.from('push_tokens').upsert(
          { user_id: user.id, token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
          { onConflict: 'user_id,token' }
        );
      }
    } catch (e) { /* non-critical */ }
    setEnabling(false);
    setVisible(false);
  }

  async function handleSkip() {
    await AsyncStorage.setItem(PUSH_PRIME_KEY, 'declined');
    setVisible(false);
  }

  const isParent = profile?.role === 'parent';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.icon}>🔔</Text>
          <Text style={styles.title}>Never miss an update</Text>
          <Text style={styles.body}>
            {isParent
              ? "Get notified the moment your child's daily log is ready, when an educator messages you, or if an incident needs your attention."
              : 'Get notified when parents message you or reply to updates about children in your classroom.'}
          </Text>
          <Button
            label={enabling ? 'Enabling...' : 'Enable notifications'}
            onPress={handleEnable}
            loading={enabling}
            style={{ alignSelf: 'stretch', marginBottom: spacing.sm }}
          />
          <Button
            label="Not now"
            onPress={handleSkip}
            variant="ghost"
            style={{ alignSelf: 'stretch' }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xxl, alignItems: 'center', alignSelf: 'stretch',
  },
  icon: { fontSize: 48, marginBottom: spacing.lg },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  body: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 21, marginBottom: spacing.xl,
  },
});

