import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function LoginScreen({ navigation }) {
  const { signIn, getRememberedAccount, clearRememberedAccount } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [remembered, setRemembered] = useState(null); // { email, name } | null
  // 'loading' → reading storage | 'picker' → tap your account
  // 'password' → remembered email + password only | 'full' → email + password
  const [mode, setMode] = useState('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      const account = await getRememberedAccount();
      if (!active) return;
      if (account?.email) {
        setRemembered(account);
        setMode('picker');
      } else {
        setMode('full');
      }
    })();
    return () => { active = false; };
  }, []);

  async function handleLogin() {
    const candidateEmail = (mode === 'password' ? remembered?.email : email) || '';

    const errs = {};
    if (!candidateEmail.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(candidateEmail.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';

    // Stored email is unusable → fall back to the full form so the
    // error is visible and fixable (email field is hidden in password mode).
    if (errs.email && mode === 'password') {
      setEmail(candidateEmail);
      setMode('full');
      setErrors(errs);
      return;
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    setErrors({});
    const { error } = await signIn(candidateEmail.trim().toLowerCase(), password);
    setLoading(false);
    if (error) {
      setErrors({ general: error.message === 'Invalid login credentials'
        ? 'Incorrect email or password. Please try again.'
        : error.message });
    } else {
      setPassword('');
    }
  }

  function handlePickRemembered() {
    setErrors({});
    setPassword('');
    setMode('password');
  }

  function handleUseAnotherAccount() {
    setErrors({});
    setEmail('');
    setPassword('');
    setMode('full');
  }

  async function handleForgetAccount() {
    await clearRememberedAccount();
    setRemembered(null);
    handleUseAnotherAccount();
  }

  const displayName = remembered?.name?.trim() || null;
  const initial = (displayName || remembered?.email || '?').charAt(0).toUpperCase();

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

      {mode !== 'loading' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{mode === 'picker' ? 'Welcome back' : 'Sign in'}</Text>

          {errors.general && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{errors.general}</Text>
            </View>
          )}

          {/* ── Picker: tap your account to continue ── */}
          {mode === 'picker' && (
            <>
              <TouchableOpacity style={styles.accountBtn} onPress={handlePickRemembered} activeOpacity={0.7}>
                <View style={styles.accountAvatar}>
                  <Text style={styles.accountAvatarText}>{initial}</Text>
                </View>
                <View style={styles.accountInfo}>
                  {displayName && <Text style={styles.accountName}>{displayName}</Text>}
                  <Text style={styles.accountEmail} numberOfLines={1}>{remembered?.email}</Text>
                </View>
                <Text style={styles.accountChevron}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleUseAnotherAccount} style={styles.linkBtn}>
                <Text style={styles.linkText}>Use another account</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleForgetAccount} style={styles.linkBtnTight}>
                <Text style={styles.forgetText}>Forget this account</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Password step: identity shown, only password needed ── */}
          {mode === 'password' && (
            <>
              <View style={styles.identityRow}>
                <View style={styles.accountAvatarSm}>
                  <Text style={styles.accountAvatarSmText}>{initial}</Text>
                </View>
                <View style={styles.accountInfo}>
                  {displayName && <Text style={styles.accountName}>{displayName}</Text>}
                  <Text style={styles.accountEmail} numberOfLines={1}>{remembered?.email}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleUseAnotherAccount}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.notYouText}>Not you?</Text>
                </TouchableOpacity>
              </View>

              <Input
                label="Password"
                value={password}
                onChangeText={(v) => { setPassword(v); if (errors.password) setErrors(e => ({ ...e, password: null })); }}
                placeholder="••••••••"
                secureTextEntry
                error={errors.password}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />

              <Button
                label="Sign in"
                onPress={handleLogin}
                loading={loading}
                style={styles.loginBtn}
              />
            </>
          )}

          {/* ── Full form: email + password ── */}
          {mode === 'full' && (
            <>
              <Input
                label="Email"
                value={email}
                onChangeText={(v) => { setEmail(v); if (errors.email) setErrors(e => ({ ...e, email: null })); }}
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
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

              {remembered?.email && (
                <TouchableOpacity onPress={() => { setErrors({}); setMode('picker'); }} style={styles.linkBtn}>
                  <Text style={styles.linkText}>Back to {remembered.email}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {mode !== 'picker' && (
            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotLink}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.signupLink}>
            <Text style={styles.signupText}>
              Don't have an account? <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
  // Remembered-account styles
  accountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.md,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  accountAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  accountAvatarSm: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  accountAvatarSmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  accountEmail: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  accountChevron: {
    fontSize: 24,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  notYouText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  linkBtn: {
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: spacing.xs,
  },
  linkText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  linkBtnTight: {
    alignItems: 'center',
    marginTop: spacing.sm,
    padding: spacing.xs,
  },
  forgetText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
