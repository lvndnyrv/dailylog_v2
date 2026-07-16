import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Input, Button, PasswordStrength } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';

export default function EditProfileScreen({ navigation }) {
  const { profile, fetchProfile, user } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone]       = useState(profile?.phone || '');
  const [saving, setSaving]     = useState(false);
  const [profileErrors, setProfileErrors] = useState({});

  // Password change fields
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw]           = useState(false);
  const [pwErrors, setPwErrors]               = useState({});

  function validateProfile() {
    const errs = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required';
    if (!phone.trim()) errs.phone = 'Phone number is required';
    setProfileErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validatePassword() {
    const errs = {};
    if (!newPassword) errs.newPassword = 'New password is required';
    else if (newPassword.length < 6) errs.newPassword = 'Password must be at least 6 characters';
    if (!confirmPassword) errs.confirmPassword = 'Please confirm your password';
    else if (newPassword !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setPwErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSaveProfile() {
    if (!validateProfile()) return;
    setSaving(true);
    setProfileErrors({});
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() })
      .eq('id', profile.id);

    setSaving(false);
    if (error) {
      setProfileErrors({ general: error.message });
    } else {
      await fetchProfile(user.id);
      showToast('✓ Profile saved', 'success');
      navigation.goBack();
    }
  }

  async function handleChangePassword() {
    if (!validatePassword()) return;
    setChangingPw(true);
    setPwErrors({});
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPw(false);

    if (error) {
      setPwErrors({ general: error.message });
    } else {
      setNewPassword(''); setConfirmPassword('');
      showToast('✓ Password updated', 'success');
    }
  }

  return (
    <KeyboardAwareScrollView style={styles.container} contentContainerStyle={styles.content} enableOnAndroid extraScrollHeight={20} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>Edit profile</Text>

      {/* Profile info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Personal info</Text>

        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{profile?.full_name?.[0] || '?'}</Text>
          </View>
          <View>
            <Text style={styles.roleLabel}>
              {profile?.role === 'admin' ? '👑 Admin' : profile?.role === 'educator' ? '👩‍🏫 Educator' : '👨‍👩‍👧 Parent'}
            </Text>
            <Text style={styles.emailLabel}>{profile?.email}</Text>
          </View>
        </View>

        {profileErrors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{profileErrors.general}</Text>
          </View>
        )}

        <Input
          label="Full name (required)"
          value={fullName}
          onChangeText={(v) => { setFullName(v); if (profileErrors.fullName) setProfileErrors(e => ({ ...e, fullName: null })); }}
          placeholder="Your full name"
          error={profileErrors.fullName}
        />
        <Input
          label="Phone number (required)"
          value={phone}
          onChangeText={(v) => { setPhone(v); if (profileErrors.phone) setProfileErrors(e => ({ ...e, phone: null })); }}
          placeholder="e.g. 905-555-0100"
          keyboardType="phone-pad"
          error={profileErrors.phone}
        />

        <Button label="Save changes" onPress={handleSaveProfile} loading={saving} />
      </View>

      {/* Password change */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change password</Text>

        {pwErrors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{pwErrors.general}</Text>
          </View>
        )}

        <Input
          label="New password"
          value={newPassword}
          onChangeText={(v) => { setNewPassword(v); if (pwErrors.newPassword) setPwErrors(e => ({ ...e, newPassword: null })); }}
          placeholder="Min. 6 characters"
          secureTextEntry
          error={pwErrors.newPassword}
        />
        <PasswordStrength password={newPassword} />
        <Input
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={(v) => { setConfirmPassword(v); if (pwErrors.confirmPassword) setPwErrors(e => ({ ...e, confirmPassword: null })); }}
          placeholder="Repeat new password"
          secureTextEntry
          error={pwErrors.confirmPassword}
        />
        <Button
          label="Update password"
          onPress={handleChangePassword}
          loading={changingPw}
          variant="ghost"
        />
      </View>

      <View style={{ height: spacing.xxxl }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  back: { marginBottom: spacing.xl },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: colors.primary },
  roleLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  emailLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#DC2626',
    lineHeight: 18,
  },
});
