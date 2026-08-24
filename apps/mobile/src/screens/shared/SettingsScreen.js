import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isAdminRole } from '@dailylog/shared';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { BIOMETRIC_KEY, biometricsAvailable } from '../../components/BiometricGate';
import { Button } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

function ProfileAvatar({ profile }) {
  const initial = profile?.display_name?.[0]
    || profile?.full_name?.[0]
    || '?';

  if (profile?.avatar_url) {
    return <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />;
  }

  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitial}>{initial.toUpperCase()}</Text>
    </View>
  );
}

function MenuIcon({ name }) {
  return (
    <View style={styles.menuIcon}>
      <Ionicons name={name} size={17} color={colors.primary} />
    </View>
  );
}

function MenuRow({ icon, label, onPress, trailing, isLast }) {
  const content = (
    <>
      <MenuIcon name={icon} />
      <Text style={styles.menuLabel}>{label}</Text>
      {trailing || <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={[styles.menuRow, !isLast && styles.menuRowBorder]}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.menuRow, !isLast && styles.menuRowBorder]}>
      {content}
    </View>
  );
}

function BalanceBadge({ cents }) {
  if (!cents) return null;
  return (
    <Text style={styles.balanceBadge}>
      {new Intl.NumberFormat('en-CA', {
        style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
      }).format(cents / 100)} due
    </Text>
  );
}

export default function SettingsScreen({ navigation }) {
  const { profile, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [centerName, setCenterName] = useState('');
  const [billingBalance, setBillingBalance] = useState(0);

  useEffect(() => {
    (async () => {
      setBioSupported(await biometricsAvailable());
      setBioEnabled((await AsyncStorage.getItem(BIOMETRIC_KEY)) === 'on');
    })();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadCenter() {
      if (!profile?.daycare_id) {
        if (active) setCenterName('');
        return;
      }
      const { data } = await supabase
        .from('daycares')
        .select('name')
        .eq('id', profile.daycare_id)
        .maybeSingle();
      if (active) setCenterName(data?.name || '');
    }
    loadCenter();
    return () => { active = false; };
  }, [profile?.daycare_id]);

  useEffect(() => {
    let active = true;
    async function loadBillingBalance() {
      if (profile?.role !== 'parent') {
        if (active) setBillingBalance(0);
        return;
      }
      const { data } = await supabase.rpc('get_parent_billing_home');
      if (active) setBillingBalance(data?.current_balance_cents || 0);
    }
    loadBillingBalance();
    return () => { active = false; };
  }, [profile?.id, profile?.role]);

  async function toggleBiometric(value) {
    if (!bioSupported) {
      Alert.alert(
        'Biometrics unavailable',
        'Face ID or fingerprint authentication is not set up on this device.'
      );
      return;
    }

    if (value) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to enable app lock',
      });
      if (!result.success) return;
    }

    await AsyncStorage.setItem(BIOMETRIC_KEY, value ? 'on' : 'off');
    setBioEnabled(value);
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: signOut },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and associated personal data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteAccount();
            setDeleting(false);
            if (error) Alert.alert('Deletion failed', error.message);
          },
        },
      ]
    );
  }

  const roleLabel = isAdminRole(profile?.role)
    ? 'Admin'
    : profile?.role === 'educator'
      ? 'Educator'
      : 'Parent';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.pageTitle}>Settings</Text>

        <View style={styles.profileCard}>
          <ProfileAvatar profile={profile} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{profile?.full_name || 'DailyLog user'}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{profile?.email}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          </View>
        </View>

        {profile?.role === 'educator' && (
          <>
            <Text style={styles.sectionTitle}>WORK</Text>
            <View style={styles.menuCard}>
              <MenuRow
                icon="time-outline"
                label="My time & time off"
                onPress={() => navigation.navigate('MyTime')}
              />
              <MenuRow
                icon="shield-checkmark-outline"
                label="My credentials"
                onPress={() => navigation.navigate('Credentials')}
                isLast
              />
            </View>
          </>
        )}

        {profile?.role === 'parent' && (
          <>
            <Text style={styles.sectionTitle}>FAMILY</Text>
            <View style={styles.menuCard}>
              <MenuRow
                icon="card-outline"
                label="Billing & payments"
                onPress={() => navigation.navigate('BillingHome')}
                trailing={billingBalance ? (
                  <View style={styles.balanceTrailing}>
                    <BalanceBadge cents={billingBalance} />
                    <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
                  </View>
                ) : undefined}
              />
              <MenuRow
                icon="shield-checkmark-outline"
                label="Child permissions & consents"
                onPress={() => navigation.navigate('ParentConsents')}
                isLast
              />
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon="create-outline"
            label="Edit profile & password"
            onPress={() => navigation.navigate('EditProfile')}
          />
          <MenuRow
            icon="lock-closed-outline"
            label="Require Face ID / fingerprint"
            isLast
            trailing={(
              <Switch
                value={bioEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.white}
                accessibilityHint={bioSupported ? undefined : 'Biometrics are unavailable on this device'}
              />
            )}
          />
        </View>

        <Text style={styles.sectionTitle}>LEGAL & PRIVACY</Text>
        <View style={styles.menuCard}>
          <MenuRow
            icon="shield-checkmark-outline"
            label="Privacy policy"
            onPress={() => navigation.navigate('Privacy')}
            isLast
          />
        </View>

        <Button
          label="Sign out"
          onPress={handleSignOut}
          variant="ghost"
          style={styles.signOutButton}
        />
        <TouchableOpacity
          onPress={handleDeleteAccount}
          disabled={deleting}
          style={styles.deleteButton}
          accessibilityRole="button"
        >
          <Text style={styles.deleteButtonText}>
            {deleting ? 'Deleting…' : 'Delete my account'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.footerNote}>
          Deleting your account permanently removes all your data.{'\n'}
          DailyLog v1.0.0{centerName ? ` · ${centerName}` : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 23,
    lineHeight: 28,
    marginBottom: spacing.lg,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    resizeMode: 'cover',
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 19,
  },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  profileEmail: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 6,
  },
  roleText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 11.5,
  },
  sectionTitle: {
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.95,
    marginBottom: spacing.sm,
  },
  menuCard: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  menuRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14.5,
  },
  balanceTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  balanceBadge: {
    overflow: 'hidden',
    color: colors.amber,
    backgroundColor: colors.amberLight,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    paddingVertical: 3,
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  signOutButton: { marginTop: spacing.xs },
  deleteButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  deleteButtonText: {
    color: colors.danger,
    fontFamily: fonts.bold,
    fontSize: 14.5,
  },
  footerNote: {
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
