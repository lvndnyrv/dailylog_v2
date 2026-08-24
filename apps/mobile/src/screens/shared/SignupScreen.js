import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Input, Button, PasswordStrength } from '../../components/ui';
import { AuthBackButton, BrandMark } from '../../components/AuthVisuals';
import { colors, fonts, spacing, radius } from '../../theme';

export default function SignupScreen({ navigation, route }) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [directorMode, setDirectorMode] = useState(Boolean(route?.params?.centerSetup));
  const [registrationCode, setRegistrationCode] = useState('');
  const [agreedTos, setAgreedTos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [verifyEmailSent, setVerifyEmailSent] = useState(false);

  const isParent = !directorMode;

  useEffect(() => {
    if (route?.params?.centerSetup) setDirectorMode(true);
  }, [route?.params?.centerSetup]);

  function validate() {
    const nextErrors = {};
    if (!fullName.trim()) nextErrors.fullName = 'Full name is required';
    if (!email.trim()) nextErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address';
    }
    if (!password) nextErrors.password = 'Password is required';
    else if (password.length < 6) {
      nextErrors.password = 'Password must be at least 6 characters';
    }
    if (isParent && !phone.trim()) nextErrors.phone = 'Phone number is required for parents';
    if (directorMode && !registrationCode.trim()) {
      nextErrors.registrationCode = 'Your DailyLog registration code is required';
    }
    if (!agreedTos) nextErrors.tos = 'You must accept the Privacy Policy to continue';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function clearError(field) {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: null }));
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    setErrors({});

    if (directorMode) {
      const { data: approvals, error: approvalError } = await supabase.rpc(
        'check_center_registration_code',
        {
          p_code: registrationCode.trim(),
          p_email: email.trim().toLowerCase(),
        }
      );
      const approval = approvals?.[0];
      if (approvalError || !approval) {
        setLoading(false);
        setErrors({
          registrationCode: approvalError?.message?.includes('Too many attempts')
            ? approvalError.message
            : 'This code is invalid, expired, already used, or was issued for another email.',
        });
        return;
      }
    }

    const { error, needsEmailConfirm } = await signUp(
      email.trim().toLowerCase(),
      password,
      fullName.trim(),
      directorMode ? 'admin' : 'parent',
      phone.trim(),
      {
        setupCenter: directorMode,
        registrationCode: directorMode ? registrationCode.trim().toUpperCase() : '',
      }
    );
    setLoading(false);

    if (error) {
      setErrors({ general: error.message });
      return;
    }
    if (needsEmailConfirm) setVerifyEmailSent(true);
  }

  if (verifyEmailSent) {
    return (
      <View style={styles.verifyContainer}>
        <View style={styles.verifyContent}>
          <BrandMark style={styles.verifyBrand} />
          <View style={styles.verifyIcon}>
            <Ionicons name="mail-outline" size={36} color={colors.primary} />
          </View>
          <Text style={styles.verifyTitle}>Check your inbox</Text>
          <Text style={styles.verifyBody}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.verifyEmail}>{email.trim()}</Text>
          </Text>
          <Text style={styles.verifyHint}>
            Open the link on this device to activate your account, then come back and sign in.
            Check your spam folder if you don't see it.
          </Text>
          <Button
            label="Back to sign in"
            onPress={() => navigation.navigate('Login')}
            style={styles.verifyButton}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={24}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <View style={styles.topRow}>
          <AuthBackButton onPress={() => navigation.goBack()} />
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
          >
            <Text style={styles.topLink}>Sign in</Text>
          </TouchableOpacity>
        </View>

        <BrandMark style={styles.brand} />

        <View style={styles.heading}>
          <Text style={styles.title}>
            {directorMode ? 'Set up your center' : 'Create account'}
          </Text>
          <Text style={styles.subtitle}>
            {directorMode
              ? 'Create the owner account for your childcare center.'
              : "Follow your child's day, step by step."}
          </Text>
        </View>

        {errors.general ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
            <Text style={styles.errorBannerText}>{errors.general}</Text>
          </View>
        ) : null}

        <View style={[styles.roleBanner, directorMode && styles.directorBanner]}>
          <View style={[styles.roleIcon, directorMode && styles.directorIcon]}>
            <Ionicons
              name={directorMode ? 'business-outline' : 'person-outline'}
              size={20}
              color={directorMode ? colors.purple : colors.primary}
            />
          </View>
          <View style={styles.roleCopy}>
            <Text style={styles.roleTitle}>
              {directorMode ? 'Owner or director account' : 'Parent account'}
            </Text>
            <Text style={styles.roleText}>
              {directorMode
                ? 'Create your owner account, then add your center details, rooms and team.'
                : "See your child's meals, naps, photos and updates in real time."}
            </Text>
          </View>
        </View>

        <View style={styles.form}>
          <Input
            label="Full name (required)"
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              clearError('fullName');
            }}
            placeholder="Jane Smith"
            textContentType="name"
            autoComplete="name"
            error={errors.fullName}
          />
          <Input
            label="Email (required)"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              clearError('email');
            }}
            placeholder="jane@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            error={errors.email}
          />
          <Input
            label="Password (required)"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              clearError('password');
            }}
            placeholder="Min. 6 characters"
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            error={errors.password}
          />
          <PasswordStrength password={password} />

          <Input
            label={isParent ? 'Phone number' : 'Phone number (optional)'}
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              clearError('phone');
            }}
            placeholder="e.g. 905-555-0100"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            error={errors.phone}
          />
          {isParent && !errors.phone ? (
            <View style={styles.hintRow}>
              <Ionicons name="call-outline" size={15} color={colors.textFaint} />
              <Text style={styles.hintText}>
                Required so educators can reach you for emergencies or early pickups.
              </Text>
            </View>
          ) : null}

          {directorMode ? (
            <>
              <Input
                label="Daycare registration code (required)"
                value={registrationCode}
                onChangeText={(value) => {
                  setRegistrationCode(value.toUpperCase());
                  clearError('registrationCode');
                }}
                placeholder="e.g. DL-A1B2-C3D4-E5F6-7890"
                autoCapitalize="characters"
                autoCorrect={false}
                error={errors.registrationCode}
              />
              {!errors.registrationCode ? (
                <View style={styles.hintRow}>
                  <Ionicons name="key-outline" size={15} color={colors.textFaint} />
                  <Text style={styles.hintText}>
                    Provided by DailyLog after your daycare registration is approved.
                    The code only works with the administrator email it was issued for.
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

        </View>

        <TouchableOpacity
          style={styles.tosRow}
          onPress={() => {
            setAgreedTos((current) => !current);
            clearError('tos');
          }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreedTos }}
        >
          <View
            style={[
              styles.tosCheckbox,
              agreedTos && styles.tosCheckboxChecked,
              errors.tos && styles.tosCheckboxError,
            ]}
          >
            {agreedTos ? (
              <Ionicons name="checkmark" size={15} color={colors.white} />
            ) : null}
          </View>
          <Text style={styles.tosLabel}>
            I agree to the{' '}
            <Text
              style={styles.link}
              onPress={() => navigation.navigate('Privacy')}
            >
              Privacy Policy
            </Text>
            {' '}and consent to my information being used to provide childcare updates.
          </Text>
        </TouchableOpacity>
        {errors.tos ? <Text style={styles.tosError}>{errors.tos}</Text> : null}

        <Button
          label={directorMode ? 'Create director account' : 'Create account'}
          onPress={handleSignup}
          loading={loading}
          style={styles.submitButton}
        />

        <View style={styles.altPaths}>
          {directorMode ? (
            <TouchableOpacity
              onPress={() => {
                setDirectorMode(false);
                setRegistrationCode('');
                setErrors({});
                navigation.setParams({ centerSetup: false });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.altText}>
                Back to <Text style={styles.link}>parent sign-up</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => {
                  navigation.navigate('CenterSetupIntro');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.altText}>
                  Daycare owner or director?{' '}
                  <Text style={styles.link}>Set up your center →</Text>
                </Text>
              </TouchableOpacity>
              <View style={styles.educatorRow}>
                <Ionicons name="mail-outline" size={16} color={colors.textFaint} />
                <Text style={styles.educatorHint}>
                  Educators: your daycare admin will send you an email invite — no sign-up
                  needed here.
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  topRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLink: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
  },
  brand: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  heading: {
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
  roleBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  directorBanner: {
    backgroundColor: colors.purpleLight,
  },
  roleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  directorIcon: {
    borderWidth: 1,
    borderColor: '#DCD2F1',
  },
  roleCopy: {
    flex: 1,
  },
  roleTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14.5,
    marginBottom: 2,
  },
  roleText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  form: {
    marginTop: spacing.xs,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  hintText: {
    flex: 1,
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  tosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  tosCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.8,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  tosCheckboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tosCheckboxError: {
    borderColor: colors.danger,
  },
  tosLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  link: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  tosError: {
    color: colors.danger,
    fontFamily: fonts.bold,
    fontSize: 12,
    marginLeft: 32,
    marginTop: spacing.xs,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
  altPaths: {
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  altText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    textAlign: 'center',
  },
  educatorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  educatorHint: {
    flex: 1,
    maxWidth: 335,
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
  },
  verifyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xxl,
  },
  verifyContent: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
  },
  verifyBrand: {
    alignSelf: 'flex-start',
    marginBottom: spacing.xxxl,
  },
  verifyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.lg,
  },
  verifyTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 24,
    textAlign: 'center',
  },
  verifyBody: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  verifyEmail: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
  },
  verifyHint: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  verifyButton: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
});
