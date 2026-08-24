import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '../../hooks/useAuth';
import { useParentAccount } from '../../hooks/useParentAccount';
import { useParentBilling } from '../../hooks/useParentBilling';
import { useParentFamily } from '../../hooks/useParentFamily';
import { useParentNotifications } from '../../hooks/useParentNotifications';
import { colors, fonts, radius, spacing } from '../../theme';
import { AccountIcon, ErrorCard, LoadingCard, initials } from './ParentAccountShared';

function formatMoney(cents) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function MenuRow({ icon, label, subtitle, badge, tone, onPress }) {
  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
    >
      <AccountIcon name={icon} tone={tone} />
      <View style={styles.menuCopy}>
        <Text style={styles.menuLabel}>{label}</Text>
        {subtitle ? <Text style={styles.menuSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {badge ? <Text style={[styles.badge, tone === 'amber' && styles.badgeAmber]}>{badge}</Text> : null}
      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function ParentMeScreen({ navigation }) {
  const { profile, signOut } = useAuth();
  const account = useParentAccount();
  const billing = useParentBilling();
  const family = useParentFamily();
  const notificationCenter = useParentNotifications();

  const load = useCallback(async () => {
    await Promise.allSettled([
      account.refreshHub(),
      account.refreshNotifications(),
      billing.refresh(),
      notificationCenter.refresh({ silent: true }),
    ]);
  }, [account.refreshHub, account.refreshNotifications, billing.refresh, notificationCenter.refresh]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const children = account.hub?.children || [];
  const selectedChild = children.find((child) => child.id === family.selectedChildId)
    || children[0]
    || null;
  const guardianCount = useMemo(() => {
    const unique = new Set();
    children.forEach((child) => (child.guardians || []).forEach((guardian) => unique.add(guardian.id)));
    return Math.max(0, unique.size - 1);
  }, [children]);
  const notificationCount = Object.values(account.notifications?.preferences || {})
    .filter(Boolean).length;
  const balance = billing.home?.current_balance_cents || 0;
  const avatarUrl = account.hub?.profile?.avatar_url || profile?.avatar_url;
  const displayName = account.hub?.profile?.full_name || profile?.full_name || 'DailyLog parent';
  const email = account.hub?.profile?.email || profile?.email || '';

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  async function openSupport() {
    const url = 'mailto:support@dailylog.app?subject=DailyLog%20parent%20support';
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('Email is unavailable');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Contact support', 'Email support@dailylog.app and include your center and account email.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={account.loading} onRefresh={load} />}
      >
        <Text style={styles.title}>Me</Text>

        {!account.hub && account.loading ? <LoadingCard /> : null}
        {!account.hub && account.error ? <ErrorCard message={account.error} onRetry={load} /> : null}

        <View style={styles.profileCard}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(displayName)}</Text>
            </View>
          )}
          <View style={styles.profileCopy}>
            <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text>
          </View>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => navigation.navigate('ParentEditProfile')}
          >
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.menuList}>
          <MenuRow
            icon="people-outline"
            label="Children & guardians"
            subtitle={children.length
              ? `${children.map((child) => child.first_name).join(', ')} · +${guardianCount} guardian${guardianCount === 1 ? '' : 's'}`
              : 'Link your child and family'}
            onPress={() => navigation.navigate('ChildrenGuardians', { childId: selectedChild?.id })}
          />
          <MenuRow
            icon="notifications-outline"
            label="Notification inbox"
            subtitle={notificationCenter.unreadCount ? 'Updates waiting for you' : 'You are all caught up'}
            badge={notificationCenter.unreadCount ? `${notificationCenter.unreadCount} new` : null}
            onPress={() => navigation.navigate('ParentNotifications')}
          />
          <MenuRow
            icon="options-outline"
            label="Notification settings"
            badge={account.notifications ? `${notificationCount} on` : null}
            onPress={() => navigation.navigate('ParentNotificationSettings')}
          />
          <MenuRow
            icon="card-outline"
            label="Billing & payments"
            badge={balance > 0 ? `${formatMoney(balance)} due` : null}
            tone={balance > 0 ? 'amber' : 'blue'}
            onPress={() => navigation.navigate('BillingHome')}
          />
          <MenuRow
            icon="document-text-outline"
            label="Documents"
            subtitle="Agreements, health forms and statements"
            onPress={() => navigation.navigate('ParentDocuments', { childId: selectedChild?.id })}
          />
          <MenuRow
            icon="checkmark-circle-outline"
            label="Authorized pickups"
            subtitle={selectedChild ? `People who can pick up ${selectedChild.first_name}` : 'Manage pickup permissions'}
            onPress={() => {
              if (selectedChild) {
                navigation.navigate('AuthorizedPickups', { child: selectedChild });
              } else {
                navigation.navigate('ChildrenGuardians');
              }
            }}
          />
          <MenuRow
            icon="shield-checkmark-outline"
            label="Privacy & data"
            onPress={() => navigation.navigate('ParentPrivacyData')}
          />
          <MenuRow
            icon="chatbubble-ellipses-outline"
            label="Help & support"
            onPress={openSupport}
          />
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={confirmSignOut}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingTop: spacing.sm, paddingBottom: 38 },
  title: {
    color: colors.textPrimary, fontFamily: fonts.black, fontSize: 24,
    marginBottom: spacing.lg,
  },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: 18,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 54, height: 54, borderRadius: 27, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 18 },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  profileEmail: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2,
  },
  editButton: {
    backgroundColor: colors.surface, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  editButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  menuList: { gap: spacing.sm },
  menuRow: {
    minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg,
  },
  menuCopy: { flex: 1, minWidth: 0 },
  menuLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  menuSubtitle: {
    color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2,
  },
  badge: {
    color: colors.primary, backgroundColor: colors.primaryLight,
    borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4,
    fontFamily: fonts.bold, fontSize: 10.5,
  },
  badgeAmber: { color: colors.amber, backgroundColor: colors.amberLight },
  signOutButton: {
    marginTop: spacing.md, minHeight: 52, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: '#F1DADA', borderRadius: radius.lg,
  },
  signOutText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 14.5 },
});
