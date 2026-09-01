import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useParentFamily } from '../hooks/useParentFamily';
import {
  getPushPermissionStatus,
  getPushPrimeChoice,
  PUSH_PRIME_KEY,
  registerForPushNotificationsAsync,
  setPushPrimeChoice,
} from '../hooks/usePushNotifications';
import { Button } from './ui';
import { colors, fonts, spacing } from '../theme';

export { PUSH_PRIME_KEY };

/**
 * Soft-ask priming screen shown once after login, BEFORE the OS
 * permission dialog. Industry standard: explain the value first,
 * so users don't reflexively tap "Don't allow".
 */
export function PushPrimingModal() {
  const { user, profile } = useAuth();
  const parentFamily = useParentFamily();
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let active = true;
    setVisible(false);

    async function check() {
      if (!user || !profile) return;
      if (
        profile.role === 'parent'
        && (
          parentFamily.loading
          || !parentFamily.children.length
          || parentFamily.pendingConsentChild
        )
      ) return;
      const answered = await getPushPrimeChoice(user.id);
      if (answered) return; // already asked
      const status = await getPushPermissionStatus();
      if (status === 'unavailable') return;
      if (status === 'granted') {
        // OS permission already granted — no need to prime
        await setPushPrimeChoice(user.id, 'accepted');
        return;
      }
      if (active) setVisible(true);
    }
    check().catch((error) => {
      console.log('Push priming check failed:', error.message);
    });

    return () => {
      active = false;
    };
  }, [
    parentFamily.children.length,
    parentFamily.loading,
    parentFamily.pendingConsentChild?.id,
    profile?.id,
    profile?.role,
    user?.id,
  ]);

  async function handleEnable() {
    setEnabling(true);
    try {
      const token = await registerForPushNotificationsAsync();
      if (token && user) {
        await supabase.from('push_tokens').upsert(
          { user_id: user.id, token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
          { onConflict: 'user_id,token' }
        );
      }
      const status = await getPushPermissionStatus();
      if (user) {
        await setPushPrimeChoice(user.id, status === 'granted' ? 'accepted' : 'declined');
      }
    } catch (error) {
      console.log('Push priming failed:', error.message);
      if (user) await setPushPrimeChoice(user.id, 'declined');
    } finally {
      setEnabling(false);
      setVisible(false);
    }
  }

  async function handleSkip() {
    if (user) await setPushPrimeChoice(user.id, 'declined');
    setVisible(false);
  }

  const isParent = profile?.role === 'parent';
  const childName = parentFamily.selectedChild?.first_name?.trim();

  return (
    <Modal
      visible={Boolean(user && visible)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleSkip}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconDisc}>
            <Ionicons name="notifications-outline" size={29} color={colors.primary} />
          </View>
          <Text style={styles.title}>{isParent ? 'Stay in the loop' : 'Never miss an update'}</Text>
          <Text style={styles.body}>
            {isParent
              ? `Get notified when ${childName || 'your child'} is checked in, when new photos arrive, and when an educator messages you.`
              : 'Get notified when parents message you or reply to updates about children in your classroom.'}
          </Text>
          <Button
            label={enabling ? 'Enabling...' : 'Enable notifications'}
            onPress={handleEnable}
            loading={enabling}
            style={{ alignSelf: 'stretch', marginBottom: spacing.sm }}
          />
          <TouchableOpacity
            onPress={handleSkip}
            activeOpacity={0.7}
            style={styles.dismissButton}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 51, 91, 0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 342,
    backgroundColor: colors.bg,
    borderRadius: 26,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 28,
    alignItems: 'center',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
  },
  iconDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  dismissButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  dismissText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
});
