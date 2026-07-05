import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button, PasswordStrength } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function SignupScreen({ navigation }) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone]       = useState('');
  const [role, setRole]         = useState('parent');
  const [agreedTos, setAgreedTos] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState({});
  const [verifyEmailSent, setVerifyEmailSent] = useState(false);

  const isParent = role === 'parent';

  function validate() {
    const errs = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (isParent && !phone.trim()) errs.phone = 'Phone number is required for parents';
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
    const { error, needsEmailConfirm } = await signUp(
      email.trim().toLowerCase(),
      password,
      fullName.trim(),
      role,
      phone.trim()
    );
    setLoading(false);
    if (error) { setErrors({ general: error.message }); return; }
    if (needsEmailConfirm) setVerifyEmailSent(true);
    // else: session exists → RootNavigator takes over automatically
  }

  const roles = [
    { key: 'parent',   label: '👨‍👩‍👧 Parent',   desc: "View your child's daily log" },
    { key: 'educator', label: '👩‍🏫 Educator', desc: 'Fill in daily logs for your classroom' },
  ];

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
        <Text style={styles.cardTitle}>Create account</Text>

        {errors.general && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        )}

        <Text style={styles.roleLabel}>I am a...</Text>
        <View style={styles.roleRow}>
          {roles.map(r => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setRole(r.key)}
              style={[styles.roleCard, role === r.key && styles.roleCardSelected]}
              activeOpacity={0.7}
            >
              <Text style={styles.roleIcon}>{r.label.split(' ')[0]}</Text>
              <Text style={[styles.roleName, role === r.key && { color: colors.primary }]}>
                {r.label.split(' ').slice(1).join(' ')}
              </Text>
              <Text style={styles.roleDesc}>{r.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

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
          label="Create account"
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
  roleRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  roleCard: {
    flex: 1, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md,
    alignItems: 'center', backgroundColor: colors.surface,
  },
  roleCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleIcon: { fontSize: 28, marginBottom: spacing.xs },
  roleName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  roleDesc: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
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
