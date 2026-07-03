import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Input, Button, Divider } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function EditProfileScreen({ navigation }) {
  const { profile, fetchProfile, user } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone]       = useState(profile?.phone || '');
  const [saving, setSaving]     = useState(false);

  // Password change fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw]           = useState(false);

  async function handleSaveProfile() {
    if (!fullName.trim()) {
      Alert.alert('Required', 'Name cannot be empty.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() })
      .eq('id', profile.id);

    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await fetchProfile(user.id);
      Alert.alert('Saved ✓', 'Your profile has been updated.');
      navigation.goBack();
    }
  }

  async function handleChangePassword() {
    if (!newPassword) {
      Alert.alert('Required', 'Please enter a new password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Too short', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New passwords do not match.');
      return;
    }
    setChangingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPw(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      Alert.alert('Password updated ✓', 'Your password has been changed successfully.');
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
              {profile?.role === 'educator' ? '👩‍🏫 Educator' : '👨‍👩‍👧 Parent'}
            </Text>
            <Text style={styles.emailLabel}>{profile?.email}</Text>
          </View>
        </View>

        <Input
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
        />
        <Input
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 905-555-0100"
          keyboardType="phone-pad"
        />

        <Button label="Save changes" onPress={handleSaveProfile} loading={saving} />
      </View>

      {/* Password change */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change password</Text>
        <Input
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Min. 6 characters"
          secureTextEntry
        />
        <Input
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Repeat new password"
          secureTextEntry
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
});
