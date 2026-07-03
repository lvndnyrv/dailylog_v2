import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
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

  async function handleSave() {
    if (!password) {
      Alert.alert('Required', 'Please enter a new password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Too short', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setSaving(true);
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
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

        <Input
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="Min. 6 characters"
          secureTextEntry
        />
        <Input
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Repeat new password"
          secureTextEntry
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
  skip: { alignItems: 'center', marginTop: spacing.lg },
  skipText: { fontSize: 13, color: colors.textMuted },
});

