import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Input, Button, PasswordStrength } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function SignupScreen({ navigation }) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone]       = useState('');
  const [directorMode, setDirectorMode] = useState(false); // admin signup path
  const [activationCode, setActivationCode] = useState('');
  const [agreedTos, setAgreedTos] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState({});
  const [verifyEmailSent, setVerifyEmailSent] = useState(false);

  const isParent = !directorMode;

  function validate() {
    const errs = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (isParent && !phone.trim()) errs.phone = 'Phone number is required for parents';
    if (directorMode && !activationCode.trim()) errs.activationCode = 'Activation code is required';
    if (!agreedTos) errs.tos = 'You must accept the Privacy Policy to continue';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function clearError(field) {
    if (errors[field]) setErrors(e => ({ ...e, [field]: null }));
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    setErrors({});

    // Director path: pre-validate the activation code for inline feedback.
    // (The DB trigger re-validates and consumes it — this check is UX only.)
    if (directorMode) {
      const { data: valid, error: checkError } = await supabase.rpc('check_daycare_signup_code', {
        p_code: activationCode.trim(),
      });
      if (checkError || !valid) {
        setLoading(false);
        setErrors({ activationCode: 'Invalid or already-used activation code. Check your subscription email or contact sales.' });
        return;
      }
    }

    const { error, needsEmailConfirm } = await signUp(
      email.trim().toLowerCase(),
      password,
      fullName.trim(),
      directorMode ? 'admin' : 'parent', // educators are invite-only — never from public signup
      phone.trim(),
      directorMode ? activationCode.trim() : ''
    );
    setLoading(false);
    if (error) { setErrors({ general: error.message }); return; }
    if (needsEmailConfirm) setVerifyEmailSent(true);
    // else: session exists → RootNavigator takes over automatically
  }


  // ─── Email verification success state ───
  if (verifyEmailSent) {
    return (
      <View style={styles.verifyContainer}>
        <Text style={styles.verifyIcon}>📬</Text>
        <Text style={styles.verifyTitle}>Check your inbox</Text>
        <Text style={styles.verifyBody}>
          We sent a confirmation link to{'\n'}
          <Text style={{ fontWeight: '700' }}>{email.trim()}</Text>
        </Text>
        <Text style={styles.verifyHint}>
          Open the link on this device to activate your account, then come back and sign in. Check your spam folder if you don't see it.
        </Text>
        <Button
          label="Back to sign in"
          onPress={() => navigation.navigate('Login')}
          style={{ alignSelf: 'stretch', marginTop: spacing.xl }}
        />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {directorMode ? 'Set up your center' : 'Create account'}
        </Text>

        {errors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        )}

        {directorMode ? (
          <View style={styles.directorBanner}>
            <Text style={styles.directorBannerIcon}>👑</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.directorBannerTitle}>Director account</Text>
              <Text style={styles.directorBannerText}>
                Requires an active DailyLog subscription. Enter the activation code
                from your welcome email — then create your daycare and invite educators.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.parentBanner}>
            <Text style={styles.parentBannerIcon}>👨‍👩‍👧</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.parentBannerTitle}>Parent account</Text>
              <Text style={styles.parentBannerText}>
                See your child's meals, naps, photos and updates in real time.
              </Text>
            </View>
          </View>
        )}

        <Input
          label="Full name (required)"
          value={fullName}
          onChangeText={(v) => { setFullName(v); clearError('fullName'); }}
          placeholder="Jane Smith"
          error={errors.fullName}
        />
        <Input
          label="Email (required)"
          value={email}
          onChangeText={(v) => { setEmail(v); clearError('email'); }}
          placeholder="jane@email.com"
          keyboardType="email-address"
          error={errors.email}
        />
        <Input
          label="Password (required)"
          value={password}
          onChangeText={(v) => { setPassword(v); clearError('password'); }}
          placeholder="Min. 6 characters"
          secureTextEntry
          error={errors.password}
        />
        <PasswordStrength password={password} />

        {/* Phone — required for parents, optional for educators */}
        <Input
          label={isParent ? 'Phone number (required)' : 'Phone number (optional)'}
          value={phone}
          onChangeText={(v) => { setPhone(v); clearError('phone'); }}
          placeholder="e.g. 905-555-0100"
          keyboardType="phone-pad"
          error={errors.phone}
        />
        {isParent && !errors.phone && (
          <Text style={styles.phoneHint}>
            📞 Required so educators can reach you for emergencies or early pickups.
          </Text>
        )}

        {/* Activation code — director mode only (paid subscription) */}
        {directorMode && (
          <>
            <Input
              label="Activation code (required)"
              value={activationCode}
              onChangeText={(v) => { setActivationCode(v.toUpperCase()); clearError('activationCode'); }}
              placeholder="e.g. K7PM3QW2"
              autoCapitalize="characters"
              error={errors.activationCode}
            />
            {!errors.activationCode && (
              <Text style={styles.phoneHint}>
                🔑 Sent with your DailyLog subscription. Don't have one? Contact sales to get started.
              </Text>
            )}
          </>
        )}

        {/* Terms & privacy acceptance */}
        <TouchableOpacity
          style={styles.tosRow}
          onPress={() => { setAgreedTos(a => !a); clearError('tos'); }}
          activeOpacity={0.7}
        >
          <View style={[styles.tosCheckbox, agreedTos && styles.tosCheckboxChecked, errors.tos && styles.tosCheckboxError]}>
            {agreedTos && <Text style={styles.tosCheckmark}>✓</Text>}
          </View>
          <Text style={styles.tosLabel}>
            I agree to the{' '}
            <Text style={styles.tosLink} onPress={() => navigation.navigate('Privacy')}>
              Privacy Policy
            </Text>
            {' '}and consent to my information being used to provide childcare updates.
          </Text>
        </TouchableOpacity>
        {errors.tos && <Text style={styles.tosError}>{errors.tos}</Text>}

        <Button
          label={directorMode ? 'Create director account' : 'Create account'}
          onPress={handleSignup}
          loading={loading}
          style={{ marginTop: spacing.md }}
        />

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink}>
          <Text style={styles.loginText}>
            Already have an account?{' '}
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>

      {/* Alternate paths */}
      <View style={styles.altPaths}>
        {directorMode ? (
          <TouchableOpacity onPress={() => { setDirectorMode(false); setErrors({}); }}>
            <Text style={styles.altPathText}>
              ← Back to <Text style={styles.altPathLink}>parent sign-up</Text>
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity onPress={() => { setDirectorMode(true); setErrors({}); }}>
              <Text style={styles.altPathText}>
                Daycare owner or director?{' '}
                <Text style={styles.altPathLink}>Set up your center →</Text>
              </Text>
            </TouchableOpacity>
            <Text style={styles.educatorHint}>
              👩‍🏫 Educators: your daycare admin will send you an email invite — no sign-up needed here.
            </Text>
          </>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: colors.bg,
    padding: spacing.xl, paddingTop: 60,
  },
  back: { marginBottom: spacing.xl },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xl },
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
  roleLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  directorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#F5F3FF', borderRadius: radius.lg,
    borderWidth: 1, borderColor: '#DDD6FE',
    padding: spacing.md, marginBottom: spacing.lg,
  },
  directorBannerIcon: { fontSize: 24 },
  directorBannerTitle: { fontSize: 14, fontWeight: '700', color: '#6D28D9' },
  directorBannerText: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  parentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.primary + '33',
    padding: spacing.md, marginBottom: spacing.lg,
  },
  parentBannerIcon: { fontSize: 24 },
  parentBannerTitle: { fontSize: 14, fontWeight: '700', color: colors.primary },
  parentBannerText: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  altPaths: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
  altPathText: { fontSize: 14, color: colors.textSecondary },
  altPathLink: { color: colors.primary, fontWeight: '600' },
  educatorHint: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center',
    lineHeight: 17, paddingHorizontal: spacing.lg,
  },
  phoneHint: {
    fontSize: 12, color: colors.textSecondary,
    marginTop: -spacing.xs, marginBottom: spacing.sm, lineHeight: 17,
  },
  tosRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.md,
  },
  tosCheckbox: {
    width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  tosCheckboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  tosCheckboxError: { borderColor: colors.danger },
  tosCheckmark: { color: colors.white, fontSize: 13, fontWeight: '700' },
  tosLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  tosLink: { color: colors.primary, fontWeight: '600' },
  tosError: { fontSize: 12, color: colors.danger, fontWeight: '500', marginTop: spacing.xs, marginLeft: 34 },
  verifyContainer: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', padding: spacing.xxl,
  },
  verifyIcon: { fontSize: 56, marginBottom: spacing.lg },
  verifyTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  verifyBody: { fontSize: 16, color: colors.textPrimary, textAlign: 'center', lineHeight: 24 },
  verifyHint: {
    fontSize: 13, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 19, marginTop: spacing.lg,
  },
  loginLink: { alignItems: 'center', marginTop: spacing.lg },
  loginText: { fontSize: 14, color: colors.textSecondary },
});
