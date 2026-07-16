import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button, PasswordStrength } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

/**
 * Shown when the user arrives via a password-recovery deep link
 * (auth PASSWORD_RECOVERY event → useAuth.recovery === true).
 */
export default function ResetPasswordScreen() {
  const { updatePassword, clearRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  function validate() {
    const errs = {};
    if (!password) errs.password = 'Password is required';
    else if (password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (!confirm) errs.confirm = 'Please confirm your password';
    else if (password !== confirm) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setErrors({});
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) {
      setErrors({ general: error.message });
    } else {
      Alert.alert('Password updated ✓', 'You are now signed in with your new password.');
    }
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      <View style={styles.card}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.cardTitle}>Choose a new password</Text>
        <Text style={styles.desc}>
          You followed a password reset link. Set a new password for your account below.
        </Text>

        {errors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        )}

        <Input
          label="New password"
          value={password}
          onChangeText={(v) => { setPassword(v); if (errors.password) setErrors(e => ({ ...e, password: null })); }}
          placeholder="Min. 6 characters"
          secureTextEntry
          error={errors.password}
        />
        <PasswordStrength password={password} />
        <Input
          label="Confirm new password"
          value={confirm}
          onChangeText={(v) => { setConfirm(v); if (errors.confirm) setErrors(e => ({ ...e, confirm: null })); }}
          placeholder="Repeat new password"
          secureTextEntry
          error={errors.confirm}
        />

        <Button label="Set new password" onPress={handleSave} loading={saving} />

        <TouchableOpacity onPress={clearRecovery} style={styles.skip}>
          <Text style={styles.skipText}>Skip — keep my current password</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: colors.bg,
    justifyContent: 'center', padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  icon: { fontSize: 40, textAlign: 'center', marginBottom: spacing.md },
  cardTitle: {
    fontSize: 20, fontWeight: '600', color: colors.textPrimary,
    textAlign: 'center', marginBottom: spacing.md,
  },
  desc: {
    fontSize: 14, color: colors.textSecondary, lineHeight: 20,
    textAlign: 'center', marginBottom: spacing.xl,
  },
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
  skip: { alignItems: 'center', marginTop: spacing.lg },
  skipText: { fontSize: 13, color: colors.textMuted },
});

