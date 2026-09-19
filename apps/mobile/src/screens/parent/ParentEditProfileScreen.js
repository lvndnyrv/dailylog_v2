import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';
import { ParentAccountHeader, initials } from './ParentAccountShared';

function Field({ label, required, value, onChangeText, error, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}{required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, error && styles.inputError]}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={`${label}${required ? ' required' : ''}`}
        accessibilityHint={error || undefined}
      />
      {error ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

function ownAvatarPath(url, userId) {
  if (!url || !userId) return null;
  const marker = '/storage/v1/object/public/profile-avatars/';
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const path = decodeURIComponent(url.slice(index + marker.length));
  return path.startsWith(`${userId}/`) ? path : null;
}

export default function ParentEditProfileScreen({ navigation }) {
  const { profile, user, fetchProfile, resetPassword } = useAuth();
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [stagedPhoto, setStagedPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name || '');
    setDisplayName(profile?.display_name || profile?.full_name?.split(/\s+/)[0] || '');
    setPhone(profile?.phone || '');
    setStagedPhoto(null);
    setRemovePhoto(false);
  }, [profile?.id]);

  const previewUri = stagedPhoto || (removePhoto ? null : profile?.avatar_url);
  const avatarLabel = useMemo(() => initials(fullName || profile?.full_name), [fullName, profile?.full_name]);

  function clearError(key) {
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  async function pickFrom(source) {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert(
        'Permission needed',
        `Allow DailyLog to access your ${source === 'camera' ? 'camera' : 'photo library'} to choose a profile photo.`
      );
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setStagedPhoto(result.assets[0].uri);
      setRemovePhoto(false);
    }
  }

  function choosePhoto() {
    Alert.alert('Profile photo', 'Choose a source. Your selection is not saved until you tap Save profile.', [
      { text: 'Take photo', onPress: () => pickFrom('camera') },
      { text: 'Photo library', onPress: () => pickFrom('library') },
      ...(previewUri ? [{ text: 'Remove photo', style: 'destructive', onPress: () => {
        setStagedPhoto(null);
        setRemovePhoto(true);
      } }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function validate() {
    const next = {};
    const trimmedName = fullName.trim();
    const trimmedDisplay = displayName.trim();
    if (!trimmedName) next.fullName = 'Full name is required.';
    else if (trimmedName.length < 2) next.fullName = 'Enter at least 2 characters.';
    if (!trimmedDisplay) next.displayName = 'Display name is required.';
    if (phone.trim().length > 32) next.phone = 'Phone number must be 32 characters or fewer.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate() || !user?.id) return;
    setSaving(true);
    setErrors({});
    let uploadedPath = null;
    try {
      let avatarUrl = removePhoto ? '' : null;
      if (stagedPhoto) {
        const resized = await ImageManipulator.manipulateAsync(
          stagedPhoto,
          [{ resize: { width: 900 } }],
          { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
        );
        const imageResponse = await fetch(resized.uri);
        const body = await imageResponse.arrayBuffer();
        uploadedPath = `${user.id}/avatar-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('profile-avatars')
          .upload(uploadedPath, body, { contentType: 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        avatarUrl = supabase.storage.from('profile-avatars').getPublicUrl(uploadedPath).data.publicUrl;
      }

      const { error: updateError } = await supabase.rpc('update_parent_profile', {
        p_full_name: fullName.trim(),
        p_display_name: displayName.trim(),
        p_phone: phone.trim() || null,
        p_avatar_url: avatarUrl,
      });
      if (updateError) throw updateError;

      const oldPath = ownAvatarPath(profile?.avatar_url, user.id);
      if (oldPath && (uploadedPath || removePhoto)) {
        await supabase.storage.from('profile-avatars').remove([oldPath]);
      }
      await fetchProfile(user.id, { silent: true });
      showToast('Profile saved', 'success');
      navigation.goBack();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('profile-avatars').remove([uploadedPath]);
      setErrors({ form: error.message || 'Your profile could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  async function sendPasswordReset() {
    if (!profile?.email || sendingReset) return;
    setSendingReset(true);
    const { error } = await resetPassword(profile.email);
    setSendingReset(false);
    if (error) {
      Alert.alert('Email not sent', error.message);
      return;
    }
    Alert.alert('Check your inbox', `We sent a secure password reset link to ${profile.email}.`);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ParentAccountHeader navigation={navigation} title="Your profile" subtitle="Your parent account and sign-in details" />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        enableOnAndroid
        extraScrollHeight={24}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.photoCard}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{avatarLabel}</Text></View>
          )}
          <View style={styles.photoCopy}>
            <Text style={styles.photoTitle}>Profile photo</Text>
            <Text style={styles.photoHint}>Visible to your family and center staff</Text>
          </View>
          <TouchableOpacity
            style={styles.photoButton}
            onPress={choosePhoto}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <Text style={styles.photoButtonText}>Change</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Field
            label="Full name"
            required
            value={fullName}
            onChangeText={(value) => { setFullName(value); clearError('fullName'); }}
            error={errors.fullName}
            placeholder="Your legal or preferred full name"
            autoCapitalize="words"
            autoComplete="name"
          />
          <Field
            label="Display name"
            required
            value={displayName}
            onChangeText={(value) => { setDisplayName(value); clearError('displayName'); }}
            error={errors.displayName}
            placeholder="What DailyLog should call you"
            autoCapitalize="words"
          />
          <Field
            label="Phone number (optional)"
            value={phone}
            onChangeText={(value) => { setPhone(value); clearError('phone'); }}
            error={errors.phone}
            placeholder="e.g. 905-555-0100"
            keyboardType="phone-pad"
            autoComplete="tel"
          />

          <Text style={styles.label}>Email · used to sign in</Text>
          <View style={styles.readOnlyRow}>
            <Text style={styles.readOnlyText} numberOfLines={1}>{profile?.email}</Text>
            <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>Verified</Text></View>
          </View>
          <Text style={styles.emailHint}>Contact support if this sign-in address needs to change.</Text>
        </View>

        <View style={styles.securityCard}>
          <View style={styles.securityIcon}>
            <Ionicons name="lock-closed-outline" size={19} color={colors.primary} />
          </View>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>Password</Text>
            <Text style={styles.securityHint}>Change it through a secure emailed link</Text>
          </View>
          <TouchableOpacity
            onPress={sendPasswordReset}
            disabled={sendingReset}
            accessibilityRole="button"
            accessibilityLabel="Change password"
          >
            {sendingReset
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={styles.resetText}>Change</Text>}
          </TouchableOpacity>
        </View>

        {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()} disabled={saving}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Save profile</Text>}
          </TouchableOpacity>
        </View>
        <Text style={styles.cancelHint}>Photo and profile changes are only applied when you save.</Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingBottom: 44, gap: spacing.md },
  photoCard: {
    minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: 18, backgroundColor: colors.primaryLight,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 29, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 19 },
  photoCopy: { flex: 1, minWidth: 0 },
  photoTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  photoHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  photoButton: { backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  photoButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  field: { marginBottom: spacing.lg },
  label: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13, marginBottom: spacing.sm },
  required: { color: colors.danger },
  input: {
    minHeight: 52, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg,
    color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger, backgroundColor: '#FDF6F6' },
  fieldError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 },
  readOnlyRow: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1.5, borderColor: colors.borderSoft, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, backgroundColor: colors.bg,
  },
  readOnlyText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14.5 },
  verifiedBadge: { backgroundColor: colors.successLight, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  verifiedText: { color: colors.success, fontFamily: fonts.bold, fontSize: 10.5 },
  emailHint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: spacing.sm },
  securityCard: {
    minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  securityIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  securityCopy: { flex: 1, minWidth: 0 },
  securityTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  securityHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  resetText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  formError: { color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, fontFamily: fonts.regular, fontSize: 12.5 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  cancelButton: {
    flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md,
  },
  cancelText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  saveButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md },
  saveText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14.5 },
  disabled: { opacity: 0.55 },
  cancelHint: { textAlign: 'center', color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
});
