import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function ForgotPasswordScreen({ navigation }) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email.trim()) {
      Alert.alert('Required', 'Please enter your email address.');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim().toLowerCase());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back to sign in</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.icon}>🔑</Text>
        <Text style={styles.cardTitle}>Reset your password</Text>

        {sent ? (
          <>
            <Text style={styles.sentText}>
              ✓ Check your inbox — we sent a password reset link to{' '}
              <Text style={{ fontWeight: '600' }}>{email.trim()}</Text>.
            </Text>
            <Text style={styles.sentHint}>
              Open the link on this device to set a new password. It may take a
              minute to arrive; check spam too.
            </Text>
            <Button
              label="Back to sign in"
              onPress={() => navigation.goBack()}
              variant="ghost"
              style={{ marginTop: spacing.lg }}
            />
          </>
        ) : (
          <>
            <Text style={styles.desc}>
              Enter the email address for your account and we'll send you a link
              to reset your password.
            </Text>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              keyboardType="email-address"
            />
            <Button label="Send reset link" onPress={handleReset} loading={loading} />
          </>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: colors.bg,
    justifyContent: 'center', padding: spacing.xl,
  },
  back: { position: 'absolute', top: 60, left: spacing.xl },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
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
  sentText: { fontSize: 15, color: colors.success, lineHeight: 22, textAlign: 'center' },
  sentHint: {
    fontSize: 13, color: colors.textSecondary, lineHeight: 19,
    textAlign: 'center', marginTop: spacing.md,
  },
});

