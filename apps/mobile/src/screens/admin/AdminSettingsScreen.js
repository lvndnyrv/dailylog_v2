import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  biometricsAvailable,
  getBiometricPreference,
  setBiometricPreference,
} from '../../components/BiometricGate';
import { showToast } from '../../components/Toast';
import { Button, Input, LoadingScreen } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function ProfileAvatar({ profile }) {
  if (profile?.avatar_url) {
    return <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />;
  }
  const initial = profile?.display_name?.[0] || profile?.full_name?.[0] || 'A';
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial.toUpperCase()}</Text>
    </View>
  );
}

function MenuIcon({ name, tone = 'primary' }) {
  const color = tone === 'danger' ? colors.danger : colors.primary;
  const backgroundColor = tone === 'danger' ? colors.dangerLight : colors.primaryLight;
  return (
    <View style={[styles.menuIcon, { backgroundColor }]}>
      <Ionicons name={name} size={18} color={color} />
    </View>
  );
}

function MenuRow({ icon, label, detail, onPress, trailing, last, tone }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress && !trailing}
      activeOpacity={0.72}
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.menuRow, !last && styles.menuRowBorder]}
    >
      <MenuIcon name={icon} tone={tone} />
      <View style={styles.menuCopy}>
        <Text style={[styles.menuLabel, tone === 'danger' && styles.dangerText]}>{label}</Text>
        {detail ? <Text style={styles.menuDetail}>{detail}</Text> : null}
      </View>
      {trailing || <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
    </TouchableOpacity>
  );
}

export default function AdminSettingsScreen({ navigation, route }) {
  const { profile, signOut } = useAuth();
  const [daycare, setDaycare] = useState(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  const rootNavigate = useCallback((screen, params) => {
    navigation.getParent()?.navigate(screen, params);
  }, [navigation]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    const [{ data, error }, supported, storedBiometrics] = await Promise.all([
      supabase.from('daycares').select('id, name, address, phone')
        .eq('id', profile.daycare_id).maybeSingle(),
      biometricsAvailable(),
      getBiometricPreference(profile.id),
    ]);
    if (error) {
      Alert.alert('Could not load settings', error.message);
    } else {
      setDaycare(data);
      setName(data?.name || '');
      setAddress(data?.address || '');
      setPhone(data?.phone || '');
    }
    setBioSupported(supported);
    setBioEnabled(storedBiometrics);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const hasChanges = name.trim() !== (daycare?.name || '')
    || address.trim() !== (daycare?.address || '')
    || phone.trim() !== (daycare?.phone || '');

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Center name required', 'Enter the name families and staff should see.');
      return;
    }
    setSaving(true);
    const updates = {
      name: name.trim(),
      address: address.trim() || null,
      phone: phone.trim() || null,
    };
    const { error } = await supabase.from('daycares').update(updates).eq('id', profile.daycare_id);
    setSaving(false);
    if (error) {
      Alert.alert('Could not save center', error.message);
      return;
    }
    setDaycare(current => ({ ...current, ...updates }));
    showToast('Center details saved', 'success');
  }

  async function toggleBiometric(value) {
    if (!bioSupported) {
      Alert.alert('Biometrics unavailable', 'Set up Face ID or a device passcode before enabling app lock.');
      return;
    }
    if (value) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to protect DailyLog',
      });
      if (!result.success) return;
    }
    await setBiometricPreference(profile.id, value);
    setBioEnabled(value);
  }

  function handleSignOut() {
    Alert.alert('Sign out of DailyLog?', 'You will need to sign in again on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        <Text style={styles.pageTitle}>Settings</Text>
        <Text style={styles.pageSubtitle}>Your account, center details and security</Text>

        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => rootNavigate('EditProfile')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Edit admin profile and password"
        >
          <ProfileAvatar profile={profile} />
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>{profile?.display_name || profile?.full_name || 'Admin'}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{profile?.email}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{profile?.role === 'owner_admin' ? 'Owner admin' : 'Admin'}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>ACCOUNT & SECURITY</Text>
        {route?.params?.focusSection === 'security' ? (
          <View style={styles.securityAlert}>
            <View style={styles.securityAlertIcon}><Ionicons name="shield-checkmark-outline" size={21} color={colors.primary} /></View>
            <View style={styles.menuCopy}>
              <Text style={styles.securityAlertTitle}>Review your account security</Text>
              <Text style={styles.securityAlertText}>A sign-in alert brought you here. If it was not you, change your password from Profile & password, then sign out this device.</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.menuCard}>
          <MenuRow icon="person-outline" label="Profile & password" detail="Name, photo and sign-in security" onPress={() => rootNavigate('EditProfile')} />
          <MenuRow icon="notifications-outline" label="Notifications" detail="Review center and staff alerts" onPress={() => rootNavigate('StaffNotifications')} />
          <MenuRow
            icon="scan-outline"
            label="Face ID app lock"
            detail={bioSupported ? 'Require authentication when opening DailyLog' : 'Not configured on this device'}
            last
            trailing={(
              <Switch
                value={bioEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.white}
                accessibilityLabel="Require Face ID app lock"
              />
            )}
          />
        </View>

        <Text style={styles.sectionLabel}>CENTER PROFILE</Text>
        <View style={styles.centerCard}>
          <View style={styles.centerHeader}>
            <View style={styles.centerIcon}><Ionicons name="business-outline" size={21} color={colors.primary} /></View>
            <View style={styles.centerHeaderCopy}>
              <Text style={styles.centerTitle}>Details families see</Text>
              <Text style={styles.centerSub}>Keep public contact information current.</Text>
            </View>
          </View>
          <Input label="Center name *" value={name} onChangeText={setName} placeholder="Center name" />
          <Input label="Address" value={address} onChangeText={setAddress} placeholder="Street, city" />
          <Input label="Phone" value={phone} onChangeText={setPhone} placeholder="Contact number" keyboardType="phone-pad" />
          {hasChanges ? (
            <View style={styles.saveRow}>
              <TouchableOpacity
                onPress={() => {
                  setName(daycare?.name || '');
                  setAddress(daycare?.address || '');
                  setPhone(daycare?.phone || '');
                }}
                style={styles.cancelButton}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button label="Save details" onPress={handleSave} loading={saving} style={styles.saveButton} />
            </View>
          ) : null}
        </View>

        <View style={styles.menuCard}>
          <MenuRow
            icon="calendar-outline"
            label="Center closures"
            detail="Publish closed days, family reminders and billing treatment"
            onPress={() => rootNavigate('CenterClosures')}
            last
          />
        </View>

        <Text style={styles.sectionLabel}>SUPPORT & PRIVACY</Text>
        <View style={styles.menuCard}>
          <MenuRow icon="documents-outline" label="Privacy & account requests" detail="Review exports and account closure requests" onPress={() => rootNavigate('AdminPrivacyRequests')} />
          <MenuRow icon="shield-checkmark-outline" label="Privacy policy" detail="How DailyLog protects center data" onPress={() => rootNavigate('Privacy')} last />
        </View>

        <View style={styles.signOutCard}>
          <MenuRow icon="log-out-outline" label="Sign out" detail="End this device session" onPress={handleSignOut} last tone="danger" />
        </View>
        <Text style={styles.footer}>DailyLog v1.0.0 · {daycare?.name || 'Your center'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  pageTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 25, lineHeight: 30 },
  pageSubtitle: { marginTop: 3, marginBottom: spacing.lg, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  avatar: { width: 58, height: 58, borderRadius: 29, resizeMode: 'cover', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 20 },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  profileEmail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  roleBadge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.purpleLight },
  roleText: { color: colors.purple, fontFamily: fonts.bold, fontSize: 10.5 },
  sectionLabel: { marginBottom: spacing.sm, color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.95 },
  menuCard: { marginBottom: spacing.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  menuRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderLight || colors.border },
  menuIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  menuCopy: { flex: 1, minWidth: 0 },
  menuLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  menuDetail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  centerCard: { padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  centerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  centerIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  centerHeaderCopy: { flex: 1 },
  centerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  centerSub: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  cancelButton: { minHeight: 46, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  cancelText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 13 },
  saveButton: { flex: 1, marginTop: 0 },
  signOutCard: { overflow: 'hidden', borderWidth: 1, borderColor: '#E9BFC0', borderRadius: radius.xl, backgroundColor: colors.surface },
  dangerText: { color: colors.danger },
  footer: { marginTop: spacing.lg, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, textAlign: 'center' },
  securityAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  securityAlertIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  securityAlertTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  securityAlertText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
});
