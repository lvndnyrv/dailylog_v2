import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
import { colors, spacing, radius, typography } from '../../theme';

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  function validate() {
    const errs = {};
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    const { error } = await signIn(email.trim().toLowerCase(), password);
    setLoading(false);
    if (error) {
      setErrors({ general: error.message === 'Invalid login credentials'
        ? 'Incorrect email or password. Please try again.'
        : error.message });
    }
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      <View style={styles.header}>
        <Text style={styles.logo}>📋</Text>
        <Text style={styles.appName}>DailyLog</Text>
        <Text style={styles.tagline}>Daycare daily reports, digitized</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sign in</Text>

        {errors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        )}

        <Input
          label="Email"
          value={email}
          onChangeText={(v) => { setEmail(v); if (errors.email) setErrors(e => ({ ...e, email: null })); }}
          placeholder="your@email.com"
          keyboardType="email-address"
          error={errors.email}
        />

        <Input
          label="Password"
          value={password}
          onChangeText={(v) => { setPassword(v); if (errors.password) setErrors(e => ({ ...e, password: null })); }}
          placeholder="••••••••"
          secureTextEntry
          error={errors.password}
        />

        <Button
          label="Sign in"
          onPress={handleLogin}
          loading={loading}
          style={styles.loginBtn}
        />

        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotLink}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.signupLink}>
          <Text style={styles.signupText}>
            Don't have an account? <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign up</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  logo: {
    fontSize: 56,
    marginBottom: spacing.sm,
  },
  appName: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  loginBtn: {
    marginTop: spacing.sm,
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
  forgotLink: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  forgotText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  signupLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  signupText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
