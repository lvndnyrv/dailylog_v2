import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useParentChildInvite } from '../../hooks/useParentChildInvite';
import { useParentFamily } from '../../hooks/useParentFamily';
import { colors, fonts, radius, spacing } from '../../theme';

const RELATIONSHIPS = ['Parent', 'Guardian', 'Grandparent', 'Foster parent', 'Other'];

function normalizedCode(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
}

function initials(firstName, lastName) {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'DL';
}

function inviteError(error) {
  const message = error?.message || '';
  if (message.includes('PARENT_INVITE_EXPIRED')) {
    return {
      kind: 'expired',
      title: 'This invitation expired',
      body: 'For your family’s security, invitation codes are time-limited. Ask your daycare or co-guardian for a new one.',
    };
  }
  if (message.includes('PARENT_INVITE_EMAIL_MISMATCH')) {
    return {
      kind: 'email',
      title: 'This invitation is for another email',
      body: 'Sign in with the email address that received the invitation, then open the link again.',
    };
  }
  if (message.includes('PARENT_INVITE_ALREADY_USED')) {
    return {
      kind: 'used',
      title: 'This invitation was already used',
      body: 'If the child is not visible in your family, ask the daycare to issue a new invitation.',
    };
  }
  if (message.includes('PARENT_INVITE_UNAVAILABLE')) {
    return {
      kind: 'unavailable',
      title: 'This child can’t be linked',
      body: 'The child’s enrollment is no longer active. Contact the daycare if this seems incorrect.',
    };
  }
  if (message.includes('PARENT_INVITE_NOT_FOUND') || message.toLowerCase().includes('invalid')) {
    return {
      kind: 'invalid',
      title: 'We couldn’t find that code',
      body: 'Check every letter and number, then try again. Codes do not use O, I, 0 or 1.',
    };
  }
  return {
    kind: 'generic',
    title: 'We couldn’t check this invitation',
    body: message || 'Check your connection and try again.',
  };
}

function Progress({ current }) {
  return (
    <View style={styles.progress}>
      {[1, 2, 3].map((step) => (
        <View key={step} style={[styles.progressBar, step <= current && styles.progressBarActive]} />
      ))}
    </View>
  );
}

function PrimaryButton({ label, onPress, loading, disabled }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={loading || disabled}
      style={[styles.primaryButton, (loading || disabled) && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

export default function ParentChildInviteScreen({ navigation, route }) {
  const inputRef = useRef(null);
  const attemptedLinkedCode = useRef(null);
  const { profile, signOut } = useAuth();
  const family = useParentFamily();
  const childInvite = useParentChildInvite();
  const incomingCode = childInvite.code || route?.params?.code || '';
  const [code, setCode] = useState(() => normalizedCode(incomingCode));
  const [stage, setStage] = useState('code');
  const [preview, setPreview] = useState(null);
  const [relationship, setRelationship] = useState('Parent');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const formattedCode = useMemo(() => {
    if (code.length <= 4) return code;
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  }, [code]);
  const relationshipOptions = useMemo(() => {
    const invitedRelationship = preview?.relationship?.trim();
    return invitedRelationship && !RELATIONSHIPS.includes(invitedRelationship)
      ? [invitedRelationship, ...RELATIONSHIPS]
      : RELATIONSHIPS;
  }, [preview?.relationship]);

  useEffect(() => {
    const normalized = normalizedCode(incomingCode);
    if (normalized) setCode(normalized);
  }, [incomingCode]);

  useEffect(() => {
    const normalized = normalizedCode(incomingCode);
    if (!normalized || attemptedLinkedCode.current === normalized) return;
    attemptedLinkedCode.current = normalized;
    previewInvite(normalized);
  // previewInvite intentionally uses the captured incoming code on first link handoff.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCode]);

  async function previewInvite(nextCode = code) {
    const normalized = normalizedCode(nextCode);
    if (normalized.length < 6) {
      setError({
        kind: 'validation',
        title: 'Enter the complete invitation code',
        body: 'Use the code from your email or the paper slip provided by your daycare.',
      });
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: previewError } = await supabase.rpc('preview_parent_child_invite', {
        p_code: normalized,
      });
      if (previewError) throw previewError;
      setCode(normalized);
      setPreview(data);
      setRelationship(data?.relationship?.trim() || 'Parent');
      if (data?.already_linked) setStage('success');
      else setStage('confirm');
    } catch (loadError) {
      setError(inviteError(loadError));
      setStage('code');
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvite() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: acceptError } = await supabase.rpc('accept_parent_child_invite', {
        p_code: code,
        p_relationship: relationship,
      });
      if (acceptError) throw acceptError;
      setPreview(data || preview);
      setStage('success');
    } catch (acceptError) {
      setError(inviteError(acceptError));
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    setLoading(true);
    try {
      const refreshFamily = family.refresh({ preferredChildId: preview?.child_id });
      await childInvite.finishInvite();
      await refreshFamily;
      if (navigation.canGoBack()) navigation.goBack();
    } finally {
      setLoading(false);
    }
  }

  async function close() {
    await childInvite.finishInvite();
    if (navigation.canGoBack()) navigation.goBack();
  }

  function resetCode() {
    attemptedLinkedCode.current = null;
    setCode('');
    setPreview(null);
    setError(null);
    setStage('code');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  if (profile && profile.role !== 'parent') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: colors.amberLight }]}>
            <Ionicons name="person-outline" size={36} color={colors.amber} />
          </View>
          <Text style={styles.successTitle}>A parent account is required</Text>
          <Text style={styles.successBody}>
            You’re signed in with a staff account. This family invitation will stay saved while you switch accounts.
          </Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Sign in with a parent account" onPress={signOut} />
          <TouchableOpacity style={styles.secondaryButton} onPress={close}>
            <Text style={styles.secondaryButtonText}>Dismiss invitation</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (stage === 'success' && preview) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={38} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>
            {preview.already_linked ? 'You’re already connected' : 'You’re connected'}
          </Text>
          <Text style={styles.successBody}>
            {preview.child_first_name} is now part of your DailyLog family. Next, we’ll confirm privacy choices and notification preferences.
          </Text>
          <View style={styles.successChildCard}>
            <View style={styles.smallAvatar}>
              <Text style={styles.smallAvatarText}>{initials(preview.child_first_name, preview.child_last_name)}</Text>
            </View>
            <View style={styles.successChildCopy}>
              <Text style={styles.successChildName}>{preview.child_first_name} {preview.child_last_name}</Text>
              <Text style={styles.successChildMeta}>{preview.daycare_name} · {preview.classroom_name || 'Room to be assigned'}</Text>
            </View>
          </View>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Continue" onPress={finish} loading={loading} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel="Close invitation" onPress={close} style={styles.headerButton}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Connect family</Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Progress current={stage === 'confirm' ? 3 : 2} />

          {stage === 'code' ? (
            <>
              <Text style={styles.title}>Connect to your daycare</Text>
              <Text style={styles.subtitle}>Enter the invitation code from the email or paper slip your daycare gave you.</Text>

              <TouchableOpacity activeOpacity={1} onPress={() => inputRef.current?.focus()} style={styles.codeArea}>
                {Array.from({ length: 8 }).map((_, index) => (
                  <View key={index} style={[styles.codeBox, index === code.length && styles.codeBoxFocused, code[index] && styles.codeBoxFilled]}>
                    <Text style={styles.codeCharacter}>{code[index] || ''}</Text>
                  </View>
                ))}
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="Invitation code"
                  value={code}
                  onChangeText={(value) => { setCode(normalizedCode(value)); setError(null); }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  style={styles.hiddenCodeInput}
                />
              </TouchableOpacity>
              <Text style={styles.formattedCode}>{formattedCode || 'XXXX-XXXX'}</Text>

              {error ? (
                <View style={styles.errorCard}>
                  <Ionicons name={error.kind === 'expired' ? 'time-outline' : 'alert-circle-outline'} size={22} color={colors.danger} />
                  <View style={styles.errorCopy}>
                    <Text style={styles.errorTitle}>{error.title}</Text>
                    <Text style={styles.errorBody}>{error.body}</Text>
                    {error.kind === 'email' ? (
                      <TouchableOpacity onPress={signOut} style={styles.errorAction}>
                        <Text style={styles.errorActionText}>Sign in with another account</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <View style={styles.infoCard}>
                <View style={styles.infoIcon}>
                  <Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} />
                </View>
                <Text style={styles.infoText}>Codes are unique to your family and expire in 7 days. The code is checked before anything is linked.</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Is this your child?</Text>
              <Text style={styles.subtitle}>{preview?.daycare_name} invited you to follow:</Text>

              <View style={styles.childCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(preview?.child_first_name, preview?.child_last_name)}</Text>
                </View>
                <Text style={styles.childName}>{preview?.child_first_name} {preview?.child_last_name}</Text>
                <Text style={styles.childMeta}>
                  {preview?.classroom_name || 'Room to be assigned'}
                  {preview?.invited_by_name ? ` · Invited by ${preview.invited_by_name}` : ''}
                </Text>
                <View style={styles.securePill}>
                  <Ionicons name="lock-closed" size={13} color={colors.success} />
                  <Text style={styles.securePillText}>Verified invitation</Text>
                </View>
              </View>

              <Text style={styles.relationshipLabel}>Your relationship</Text>
              <View style={styles.relationships}>
                {relationshipOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setRelationship(option)}
                    style={[styles.relationshipChip, relationship === option && styles.relationshipChipActive]}
                  >
                    <Text style={[styles.relationshipText, relationship === option && styles.relationshipTextActive]}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {error ? (
                <View style={styles.errorCard}>
                  <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
                  <View style={styles.errorCopy}>
                    <Text style={styles.errorTitle}>{error.title}</Text>
                    <Text style={styles.errorBody}>{error.body}</Text>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {stage === 'code' ? (
            <>
              <PrimaryButton label="Continue" onPress={() => previewInvite()} loading={loading} disabled={code.length < 6} />
              <Text style={styles.footerHint}>No code? Ask your daycare to resend your family invitation.</Text>
            </>
          ) : (
            <>
              <PrimaryButton label={`Yes, link ${preview?.child_first_name}`} onPress={acceptInvite} loading={loading} />
              <TouchableOpacity style={styles.secondaryButton} onPress={resetCode} disabled={loading}>
                <Text style={styles.secondaryButtonText}>This isn’t my child</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  progress: { flexDirection: 'row', gap: 6, marginBottom: spacing.xxl },
  progressBar: { width: 28, height: 6, borderRadius: radius.full, backgroundColor: colors.borderStrong },
  progressBarActive: { backgroundColor: colors.primary },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 25, lineHeight: 31 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 23, marginTop: spacing.sm },
  codeArea: { position: 'relative', flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginTop: spacing.xxl },
  codeBox: { flex: 1, height: 54, minWidth: 33, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  codeBoxFocused: { borderColor: colors.primary },
  codeBoxFilled: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  codeCharacter: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  hiddenCodeInput: { position: 'absolute', inset: 0, opacity: 0.02, color: 'transparent' },
  formattedCode: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.5, textAlign: 'center', marginTop: spacing.sm },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, marginTop: spacing.xl },
  infoIcon: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: '#EFCACA', borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13 },
  errorBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, marginTop: 3 },
  errorAction: { alignSelf: 'flex-start', marginTop: spacing.sm },
  errorActionText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  childCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.xl, marginTop: spacing.xl },
  avatar: { width: 76, height: 76, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 24 },
  childName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, marginTop: spacing.md },
  childMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', marginTop: 4 },
  securePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.successLight, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.md },
  securePillText: { color: colors.success, fontFamily: fonts.bold, fontSize: 11.5 },
  relationshipLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginTop: spacing.xl, marginBottom: spacing.sm },
  relationships: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  relationshipChip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 9 },
  relationshipChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  relationshipText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 12 },
  relationshipTextActive: { color: colors.primary },
  footer: { borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  primaryButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  disabled: { opacity: 0.5 },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  footerHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: spacing.md },
  successContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xxl },
  successIcon: { width: 80, height: 80, borderRadius: radius.full, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  successTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 26, textAlign: 'center' },
  successBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 23, textAlign: 'center', marginTop: spacing.md },
  successChildCard: { width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xxl },
  smallAvatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  smallAvatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 15 },
  successChildCopy: { flex: 1, marginLeft: spacing.md },
  successChildName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  successChildMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
});
