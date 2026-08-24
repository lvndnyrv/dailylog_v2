import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, PasswordStrength } from '../../components/ui';
import { BrandMark } from '../../components/AuthVisuals';
import { useAuth } from '../../hooks/useAuth';
import { useStaffInvite } from '../../hooks/useStaffInvite';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const STAFF_TERMS_VERSION = '2026-08-08';

function initials(name, email) {
  const source = name?.trim() || email?.split('@')[0] || '?';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function roleLabel(role) {
  if (role === 'owner_admin') return 'Owner admin';
  if (role === 'admin') return 'Admin';
  return 'Educator';
}

function firstName(name, email) {
  return name?.trim().split(/\s+/)[0] || email?.split('@')[0] || 'there';
}

function inviteExpiry(expiresAt) {
  if (!expiresAt) return 'This invite is ready when you are';
  const expiry = new Date(expiresAt);
  const days = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
  if (days === 0) return 'This invite expires today';
  if (days === 1) return 'This invite expires in 1 day';
  return `This invite expires in ${days} days`;
}

export default function StaffInviteScreen({ navigation }) {
  const { user, profile, signOut, fetchProfile } = useAuth();
  const {
    code,
    accepted,
    markAccepted,
    finishInvite,
    suspendInvite,
  } = useStaffInvite();

  const [invite, setInvite] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(Boolean(code));
  const [inviteError, setInviteError] = useState(null);
  const [step, setStep] = useState(accepted ? 'success' : 'landing');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [verifyEmail, setVerifyEmail] = useState(false);

  useEffect(() => {
    if (accepted) setStep('success');
  }, [accepted]);

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      if (!code || accepted) return;
      setLoadingInvite(true);
      setInviteError(null);

      const { data, error } = await supabase.rpc('get_staff_invite', {
        p_code: code,
      });
      if (!active) return;

      const preview = data?.[0] || null;
      if (error || !preview) {
        setInviteError(
          error?.message ||
          'This invitation has expired or has already been accepted.'
        );
        setInvite(null);
      } else {
        setInvite(preview);
        setFullName((current) => (
          current || profile?.full_name || preview.full_name || ''
        ));
        setPhone((current) => current || profile?.phone || '');
      }
      setLoadingInvite(false);
    }

    loadInvite();
    return () => { active = false; };
  }, [accepted, code, profile?.full_name, profile?.phone]);

  const summary = accepted || invite;
  const signedInEmail = user?.email?.trim().toLowerCase();
  const invitedEmail = invite?.email?.trim().toLowerCase();
  const emailMismatch = Boolean(
    signedInEmail && invitedEmail && signedInEmail !== invitedEmail
  );
  const isExistingAccount = Boolean(user && !emailMismatch);

  const inviterCopy = useMemo(() => {
    if (!invite) return '';
    const inviter = invite.invited_by_name || 'Your director';
    const relationship = invite.role === 'educator' ? 'an educator' : roleLabel(invite.role);
    return `${inviter} added you as ${relationship}.`;
  }, [invite]);

  async function chooseDifferentAccount() {
    if (user) await signOut();
    suspendInvite();
  }

  function continueToPassword() {
    const name = fullName.trim();
    if (name.length < 2) {
      setFormError('Enter your full name.');
      return;
    }
    setFormError(null);
    setStep('password');
  }

  async function finishAcceptance(activeUser) {
    const activeEmail = activeUser?.email?.trim().toLowerCase();
    if (!activeUser || activeEmail !== invitedEmail) {
      throw new Error('Sign in with the email address this invitation was sent to.');
    }

    const { error: acceptError } = await supabase.rpc('accept_staff_invite', {
      p_code: code,
      p_terms_version: STAFF_TERMS_VERSION,
      p_terms_accepted: true,
    });
    if (acceptError) throw acceptError;

    const safeProfile = {
      full_name: fullName.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    };
    const { error: profileError } = await supabase
      .from('profiles')
      .update(safeProfile)
      .eq('id', activeUser.id);
    if (profileError) {
      console.warn('Invite accepted but profile details could not be updated:', profileError.message);
    }

    await markAccepted({
      daycare_name: invite.daycare_name,
      classroom_name: invite.classroom_name,
      email: invite.email,
      full_name: fullName.trim(),
      role: invite.role,
      job_title: invite.job_title,
    });
    await fetchProfile(activeUser.id);
  }

  async function submitInvite() {
    setFormError(null);
    if (!agreed) {
      setFormError('Agree to the Staff Terms and confidentiality policy to continue.');
      return;
    }
    if (emailMismatch) {
      setFormError('This invite was sent to a different email address.');
      return;
    }
    if (!isExistingAccount) {
      if (password.length < 6) {
        setFormError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setFormError('The passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      let activeUser = user;

      if (!activeUser) {
        // Reuse the already-configured Supabase auth callback and carry the
        // separate business invite code alongside its auth token/code.
        const redirectTo =
          `dailylog://auth?invite_code=${encodeURIComponent(code)}`;
        const signUpResult = await supabase.auth.signUp({
          email: invite.email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              full_name: fullName.trim(),
              phone: phone.trim(),
            },
          },
        });

        const alreadyRegistered =
          signUpResult.error?.message?.toLowerCase().includes('already registered') ||
          (!signUpResult.error &&
            signUpResult.data?.user &&
            signUpResult.data.user.identities?.length === 0);

        if (alreadyRegistered) {
          const signInResult = await supabase.auth.signInWithPassword({
            email: invite.email,
            password,
          });
          if (signInResult.error) {
            throw new Error(
              'This email already has an account. Enter its current password to join the center.'
            );
          }
          activeUser = signInResult.data.user;
        } else if (signUpResult.error) {
          throw signUpResult.error;
        } else if (!signUpResult.data.session) {
          setVerifyEmail(true);
          return;
        } else {
          activeUser = signUpResult.data.user;
        }
      }

      await finishAcceptance(activeUser);
    } catch (error) {
      setFormError(error?.message || 'The invitation could not be accepted.');
    } finally {
      setSubmitting(false);
    }
  }

  async function openClassroom() {
    if (user) await fetchProfile(user.id);
    await finishInvite();
  }

  if (loadingInvite && !accepted) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.stateText}>Opening your invitation…</Text>
      </View>
    );
  }

  if (inviteError && !accepted) {
    const alreadyJoined = Boolean(user && profile?.daycare_id);
    return (
      <View style={styles.centeredState}>
        <View style={[styles.stateIcon, styles.errorIcon]}>
          <Ionicons name="mail-unread-outline" size={34} color={colors.danger} />
        </View>
        <Text style={styles.stateTitle}>This invite isn’t available</Text>
        <Text style={styles.stateText}>{inviteError}</Text>
        <Button
          label={alreadyJoined ? 'Go to my account' : 'Go to sign in'}
          onPress={async () => {
            await finishInvite();
            if (!user) suspendInvite();
          }}
          style={styles.stateButton}
        />
      </View>
    );
  }

  if (step === 'success' && summary) {
    return (
      <View style={styles.successScreen}>
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={42} color={colors.success} />
          </View>
          <View style={styles.centerCopy}>
            <Text style={styles.successTitle}>You’re on the team!</Text>
            <Text style={styles.successText}>
              Welcome to{' '}
              <Text style={styles.strong}>{summary.daycare_name}</Text>,{' '}
              {firstName(summary.full_name, summary.email)}.
              {summary.classroom_name
                ? `\nYou’re set up in the ${summary.classroom_name} room.`
                : '\nYour director can assign your classroom next.'}
            </Text>
          </View>

          <View style={styles.getStartedCard}>
            <Text style={styles.getStartedTitle}>Get started</Text>
            <NumberedStep number="1" active text="Meet your classroom & roster." />
            <NumberedStep number="2" text="Clock in when you arrive." />
            <NumberedStep number="3" text="Start logging your first day." />
          </View>
        </View>
        <Button
          label={summary.role === 'educator' ? 'Go to my classroom' : 'Go to my dashboard'}
          onPress={openClassroom}
          style={styles.bottomButton}
        />
      </View>
    );
  }

  if (!invite) return null;

  if (step === 'landing') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.landingContent}
        showsVerticalScrollIndicator={false}
      >
        <BrandMark stacked style={styles.brand} />
        <TeamArtwork />

        <View style={styles.centerCopy}>
          <Text style={styles.inviteTitle}>
            You’re invited to join{'\n'}{invite.daycare_name}
          </Text>
          <Text style={styles.subtitle}>{inviterCopy}</Text>
        </View>

        <IdentityCard invite={invite} large />

        <View style={styles.expiryCard}>
          <Ionicons name="time-outline" size={19} color={colors.primary} />
          <Text style={styles.expiryText}>{inviteExpiry(invite.expires_at)}</Text>
        </View>

        {emailMismatch ? (
          <ErrorBanner>
            You’re signed in as {user.email}. This invitation is for {invite.email}.
          </ErrorBanner>
        ) : null}

        <Button
          label="Accept invite"
          onPress={() => setStep('details')}
          disabled={emailMismatch}
        />
        <TouchableOpacity
          onPress={chooseDifferentAccount}
          accessibilityRole="button"
          style={styles.quietAction}
        >
          <Text style={styles.quietText}>
            Not you? <Text style={styles.link}>Sign in to a different account</Text>
          </Text>
        </TouchableOpacity>
        {emailMismatch ? (
          <TouchableOpacity
            onPress={finishInvite}
            accessibilityRole="button"
            style={styles.quietAction}
          >
            <Text style={styles.quietText}>
              <Text style={styles.link}>Dismiss invitation</Text> and use my account
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }

  if (step === 'details') {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Header title="Confirm your details" onBack={() => setStep('landing')} />

          <Text style={styles.eyebrow}>YOUR ROLE</Text>
          <View style={styles.detailCard}>
            <DetailRow label="Role" value={roleLabel(invite.role)} />
            {invite.job_title ? (
              <DetailRow label="Job title" value={invite.job_title} />
            ) : null}
            <DetailRow label="Center" value={invite.daycare_name} />
            <DetailRow label="Room" value={invite.classroom_name || 'To be assigned'} last />
          </View>
          <Text style={styles.helper}>
            Set by your director. Ask {invite.invited_by_name || 'your center'} if anything
            looks wrong.
          </Text>

          {invite.require_background_check ? (
            <View style={styles.requirementCard}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.amber} />
              <View style={styles.requirementCopy}>
                <Text style={styles.requirementTitle}>Background check required</Text>
                <Text style={styles.requirementText}>
                  You can join now. Your director will confirm clearance before assigning independent duties.
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.eyebrow}>YOUR PROFILE</Text>
          <Input
            label="Full name"
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              setFormError(null);
            }}
            placeholder="Your full name"
            textContentType="name"
            autoComplete="name"
          />
          <Input
            label="Mobile (for emergency contact)"
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. 905-555-0100"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
          />
          {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}
          <Button label="Continue" onPress={continueToPassword} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (verifyEmail) {
    return (
      <View style={styles.centeredState}>
        <View style={styles.stateIcon}>
          <Ionicons name="mail-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.stateTitle}>Confirm your email</Text>
        <Text style={styles.stateText}>
          We sent a confirmation link to{'\n'}
          <Text style={styles.strong}>{invite.email}</Text>
          {'\n\n'}Open it on this device. Your invitation will still be waiting here.
        </Text>
        <Button
          label="Back to invitation"
          onPress={() => setVerifyEmail(false)}
          variant="ghost"
          style={styles.stateButton}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Header title={isExistingAccount ? 'Join your center' : 'Set your password'} onBack={() => setStep('details')} />
        <IdentityCard invite={{ ...invite, full_name: fullName }} />

        {emailMismatch ? (
          <>
            <ErrorBanner>
              Sign out of {user.email} and sign in as {invite.email} to accept this invite.
            </ErrorBanner>
            <Button label="Use a different account" onPress={chooseDifferentAccount} />
          </>
        ) : (
          <>
            {isExistingAccount ? (
              <View style={styles.existingAccount}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.existingAccountText}>
                  Signed in as {user.email}. You can join with this existing account.
                </Text>
              </View>
            ) : (
              <>
                <Input
                  label="Password"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setFormError(null);
                  }}
                  placeholder="Min. 6 characters"
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <PasswordStrength password={password} />
                <Input
                  label="Confirm password"
                  value={confirmPassword}
                  onChangeText={(value) => {
                    setConfirmPassword(value);
                    setFormError(null);
                  }}
                  placeholder="Re-enter password"
                  secureTextEntry
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
              </>
            )}

            <View style={styles.termsRow}>
              <TouchableOpacity
              onPress={() => {
                setAgreed((current) => !current);
                setFormError(null);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel="Accept Staff Terms and confidentiality policy"
              activeOpacity={0.72}
              style={styles.checkboxHitArea}
              >
              <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                {agreed ? (
                  <Ionicons name="checkmark" size={15} color={colors.white} />
                ) : null}
              </View>
              </TouchableOpacity>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => navigation.navigate('StaffTerms')}
                >
                  Staff Terms
                </Text>
                {' '}and confidentiality policy.
              </Text>
            </View>

            {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}
            <Button
              label={isExistingAccount ? 'Accept invite & join' : 'Create account & join'}
              onPress={submitInvite}
              loading={submitting}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({ title, onBack }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function IdentityCard({ invite, large = false }) {
  return (
    <View style={[styles.identityCard, large && styles.identityCardLarge]}>
      <View style={[styles.avatar, large && styles.avatarLarge]}>
        <Text style={styles.avatarText}>{initials(invite.full_name, invite.email)}</Text>
      </View>
      <View style={styles.identityCopy}>
        <Text style={[styles.identityName, large && styles.identityNameLarge]}>
          {invite.full_name || 'Your staff account'}
        </Text>
        <Text style={styles.identityEmail} numberOfLines={1}>
          {invite.email}{large ? ' · invited' : ''}
        </Text>
      </View>
    </View>
  );
}

function DetailRow({ label, value, last }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function NumberedStep({ number, text, active }) {
  return (
    <View style={styles.numberedStep}>
      <View style={[styles.stepNumber, active && styles.stepNumberActive]}>
        <Text style={[styles.stepNumberText, active && styles.stepNumberTextActive]}>
          {number}
        </Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function ErrorBanner({ children }) {
  return (
    <View style={styles.errorBanner}>
      <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

function TeamArtwork() {
  return (
    <View style={styles.artwork}>
      <View style={styles.artGlow} />
      <View style={[styles.person, styles.personLeft]}>
        <View style={[styles.personHead, { backgroundColor: '#D9A374' }]} />
        <View style={[styles.personBody, { backgroundColor: colors.purple }]} />
      </View>
      <View style={[styles.person, styles.personCenter]}>
        <View style={[styles.personHead, { backgroundColor: '#9B684E' }]} />
        <View style={[styles.personBody, { backgroundColor: colors.primary }]} />
      </View>
      <View style={[styles.person, styles.personRight]}>
        <View style={[styles.personHead, { backgroundColor: '#E0B28A' }]} />
        <View style={[styles.personBody, { backgroundColor: colors.success }]} />
      </View>
      <View style={styles.artBadge}>
        <Ionicons name="sparkles" size={23} color={colors.amber} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  landingContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  formContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  brand: { alignSelf: 'center' },
  centerCopy: { alignItems: 'center' },
  inviteTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  identityCard: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  identityCardLarge: { minHeight: 72, marginBottom: 0 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  avatarLarge: { width: 42, height: 42, borderRadius: 21 },
  avatarText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  identityName: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  identityNameLarge: { fontSize: 15 },
  identityEmail: {
    marginTop: 2,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  expiryCard: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  expiryText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  quietAction: { alignItems: 'center', paddingVertical: spacing.xs },
  quietText: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  link: { fontFamily: fonts.bold, color: colors.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  eyebrow: {
    marginBottom: spacing.sm,
    fontSize: 12,
    letterSpacing: 0.8,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  detailCard: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  detailRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.primarySoft,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  detailValue: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  helper: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  requirementCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: -spacing.md,
    marginBottom: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.amberLight,
  },
  requirementCopy: { flex: 1 },
  requirementTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  requirementText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  checkboxHitArea: {
    width: 30,
    minHeight: 30,
    marginLeft: -5,
    marginTop: -5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  termsLink: { fontFamily: fonts.bold, color: colors.primary },
  existingAccount: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.successLight,
  },
  existingAccountText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.danger,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.bg,
  },
  stateIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    backgroundColor: colors.primaryLight,
  },
  errorIcon: { backgroundColor: colors.dangerLight },
  stateTitle: {
    marginBottom: spacing.sm,
    fontSize: 23,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateText: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  stateButton: { width: '100%', maxWidth: 340, marginTop: spacing.xl },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  successScreen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.bg,
  },
  successBody: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  successIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
  },
  successTitle: {
    fontSize: 23,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  successText: {
    marginTop: spacing.xs,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  getStartedCard: {
    width: '100%',
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  getStartedTitle: {
    fontSize: 14,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  numberedStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  stepNumberActive: { backgroundColor: colors.primary },
  stepNumberText: {
    fontSize: 12,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  stepNumberTextActive: { color: colors.white },
  stepText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  bottomButton: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  artwork: {
    height: 150,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderRadius: radius.xl,
    backgroundColor: '#EAF2FC',
  },
  artGlow: {
    position: 'absolute',
    top: 16,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#D9E9FB',
  },
  person: {
    position: 'absolute',
    bottom: 16,
    alignItems: 'center',
  },
  personLeft: { left: '19%', transform: [{ scale: 0.82 }] },
  personCenter: { bottom: 10, zIndex: 2 },
  personRight: { right: '19%', transform: [{ scale: 0.88 }] },
  personHead: { width: 38, height: 38, borderRadius: 19, zIndex: 2 },
  personBody: {
    width: 66,
    height: 72,
    marginTop: -4,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  artBadge: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.lg,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
