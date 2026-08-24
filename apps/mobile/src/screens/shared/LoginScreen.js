import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
import { AuthArtwork, AuthBackButton, BrandMark } from '../../components/AuthVisuals';
import { colors, fonts, spacing, radius } from '../../theme';

export default function LoginScreen({ navigation }) {
  const { signIn, getRememberedAccount, clearRememberedAccount } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [remembered, setRemembered] = useState(null);
  // loading → local storage | picker → design 1a | password/full → design 1b
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
  }, [getRememberedAccount]);

  async function handleLogin() {
    const candidateEmail = (mode === 'password' ? remembered?.email : email) || '';
    const nextErrors = {};

    if (!candidateEmail.trim()) nextErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(candidateEmail.trim())) {
      nextErrors.email = 'Enter a valid email address';
    }
    if (!password) nextErrors.password = 'Password is required';

    if (nextErrors.email && mode === 'password') {
      setEmail(candidateEmail);
      setMode('full');
      setErrors(nextErrors);
      return;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    setErrors({});
    const { error } = await signIn(candidateEmail.trim().toLowerCase(), password);
    setLoading(false);

    if (error) {
      setErrors({
        general: error.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : error.message,
      });
      return;
    }
    setPassword('');
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

  function handleBack() {
    setErrors({});
    setPassword('');
    if (remembered?.email) setMode('picker');
  }

  const displayName = remembered?.name?.trim() || null;
  const initial = (displayName || remembered?.email || '?').charAt(0).toUpperCase();

  if (mode === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (mode === 'picker') {
    return (
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.pickerContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <BrandMark />
          <AuthArtwork style={styles.welcomeArtwork} />

          <View>
            <Text style={styles.title}>Welcome back!</Text>
            <Text style={styles.subtitle}>
              Your classroom is ready. Pick up right where you left off.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.accountCard}
            onPress={handlePickRemembered}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Continue as ${displayName || remembered?.email}`}
          >
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>{initial}</Text>
            </View>
            <View style={styles.accountInfo}>
              {displayName ? <Text style={styles.accountName}>{displayName}</Text> : null}
              <Text style={styles.accountEmail} numberOfLines={1}>{remembered?.email}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </TouchableOpacity>

          <Button label="Continue" onPress={handlePickRemembered} />

          <View style={styles.linkGroup}>
            <TouchableOpacity onPress={handleUseAnotherAccount} accessibilityRole="button">
              <Text style={styles.primaryLink}>Use another account</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleForgetAccount} accessibilityRole="button">
              <Text style={styles.quietLink}>Forget this account</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')} accessibilityRole="button">
              <Text style={styles.promptText}>
                Don't have an account? <Text style={styles.primaryLink}>Sign up</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.scroll}
      contentContainerStyle={styles.formContainer}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={24}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <View style={styles.backRow}>
          {remembered?.email
            ? <AuthBackButton onPress={handleBack} />
            : <View style={styles.backPlaceholder} />}
        </View>

        <BrandMark stacked style={styles.centeredBrand} />

        {errors.general ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        ) : null}

        {mode === 'password' ? (
          <View style={styles.identityCard}>
            <View style={styles.identityAvatar}>
              <Text style={styles.identityAvatarText}>{initial}</Text>
            </View>
            <View style={styles.accountInfo}>
              {displayName ? <Text style={styles.identityName}>{displayName}</Text> : null}
              <Text style={styles.identityEmail} numberOfLines={1}>{remembered?.email}</Text>
            </View>
            <TouchableOpacity onPress={handleUseAnotherAccount} accessibilityRole="button">
              <Text style={styles.notYouText}>Not you?</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.signInTitle}>Sign in</Text>
            <Text style={styles.signInSubtitle}>Welcome back to your DailyLog account.</Text>
          </View>
        )}

        <View style={styles.formFields}>
          {mode === 'full' ? (
            <Input
              label="Email"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (errors.email) setErrors((current) => ({ ...current, email: null }));
              }}
              placeholder="your@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              error={errors.email}
            />
          ) : null}

          <Input
            label="Password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (errors.password) setErrors((current) => ({ ...current, password: null }));
            }}
            placeholder="Enter your password"
            secureTextEntry
            autoFocus={mode === 'password'}
            textContentType="password"
            autoComplete="current-password"
            error={errors.password}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />
        </View>

        <Button label="Sign in" onPress={handleLogin} loading={loading} />

        <View style={styles.linkGroup}>
          <TouchableOpacity
            onPress={() => navigation.navigate('ForgotPassword')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryLink}>Forgot password?</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Signup')} accessibilityRole="button">
            <Text style={styles.promptText}>
              Don't have an account? <Text style={styles.primaryLink}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <AuthArtwork compact style={styles.footerArtwork} />
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  pickerContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  formContainer: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  welcomeArtwork: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.35,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  accountCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  accountAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  accountAvatarText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 15,
    marginBottom: 2,
  },
  accountEmail: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12.5,
  },
  linkGroup: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  primaryLink: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  quietLink: {
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  promptText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  backRow: {
    minHeight: 42,
    justifyContent: 'center',
  },
  backPlaceholder: {
    height: 40,
  },
  centeredBrand: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerLight,
    borderWidth: 1,
    borderColor: '#EDBABA',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorBannerText: {
    flex: 1,
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  identityCard: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  identityAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  identityAvatarText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  identityName: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14,
    marginBottom: 1,
  },
  identityEmail: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  notYouText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  signInTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 32,
  },
  signInSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  formFields: {
    marginTop: spacing.xs,
  },
  footerArtwork: {
    marginTop: spacing.xl,
  },
});
