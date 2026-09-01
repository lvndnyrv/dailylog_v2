import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useParentAccount } from '../../hooks/useParentAccount';
import { useParentFamily } from '../../hooks/useParentFamily';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  ErrorCard,
  LoadingCard,
  ParentAccountHeader,
  initials,
} from './ParentAccountShared';

function ageLabel(dateOfBirth) {
  if (!dateOfBirth) return '';
  const born = new Date(`${dateOfBirth}T12:00:00`);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const birthdayPassed = now.getMonth() > born.getMonth()
    || (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
  if (!birthdayPassed) years -= 1;
  return years >= 1 ? `age ${years}` : 'under 1';
}

function shortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function guardianInviteMessage(child, invite) {
  const link = `dailylog://family-invite?code=${encodeURIComponent(invite.code)}`;
  return `${invite.email}, you have been invited to join ${child.first_name}'s DailyLog family. Open ${link} or enter code ${invite.code}. This code expires ${shortDate(invite.expires_at)}.`;
}

function Field({ label, value, onChangeText, placeholder, error, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label} <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoCorrect={keyboardType !== 'email-address'}
        accessibilityLabel={`${label} required`}
        accessibilityHint={error || undefined}
      />
      {error ? <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

function InviteGuardianSheet({ visible, child, onClose, onCreated }) {
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setEmail('');
      setRelationship('');
      setErrors({});
    }
  }, [visible]);

  async function submit() {
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!relationship.trim()) nextErrors.relationship = 'Relationship is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      const invite = await onCreated(child.id, email.trim(), relationship.trim());
      onClose();
      await Share.share({
        title: `DailyLog invitation for ${child.first_name}`,
        message: guardianInviteMessage(child, invite),
      });
    } catch (error) {
      setErrors({ form: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Invite a co-guardian</Text>
          <Text style={styles.sheetSubtitle}>
            They will be able to see {child?.first_name}'s updates and communicate with the center.
          </Text>
          <Field
            label="Email"
            value={email}
            onChangeText={(value) => { setEmail(value); setErrors((current) => ({ ...current, email: '' })); }}
            placeholder="guardian@email.com"
            keyboardType="email-address"
            error={errors.email}
          />
          <Field
            label="Relationship"
            value={relationship}
            onChangeText={(value) => { setRelationship(value); setErrors((current) => ({ ...current, relationship: '' })); }}
            placeholder="e.g. Parent, grandparent"
            error={errors.relationship}
          />
          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Create & share invitation</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ChildrenGuardiansScreen({ navigation, route }) {
  const account = useParentAccount();
  const family = useParentFamily();
  const [inviteChild, setInviteChild] = useState(null);
  const [cancellingInvite, setCancellingInvite] = useState('');

  const load = useCallback(() => account.refreshHub().catch(() => {}), [account.refreshHub]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (route.params?.childId) family.selectChild(route.params.childId);
  }, [family.selectChild, route.params?.childId]);

  async function createInvite(childId, email, relationship) {
    const invite = await account.inviteGuardian(childId, email, relationship);
    await account.refreshHub();
    return invite;
  }

  async function sharePendingInvite(child, invite) {
    if (!invite.code) {
      Alert.alert('Invitation unavailable', 'Refresh this page, then try sharing the invitation again.');
      return;
    }
    await Share.share({
      title: `DailyLog invitation for ${child.first_name}`,
      message: guardianInviteMessage(child, invite),
    });
  }

  function confirmCancelInvite(invite) {
    Alert.alert(
      'Cancel invitation?',
      `${invite.email} will no longer be able to use this invitation code.`,
      [
        { text: 'Keep invitation', style: 'cancel' },
        {
          text: 'Cancel invitation',
          style: 'destructive',
          onPress: async () => {
            setCancellingInvite(invite.id);
            try {
              await account.cancelGuardianInvite(invite.id);
            } catch (error) {
              Alert.alert('Could not cancel invitation', error.message);
            } finally {
              setCancellingInvite('');
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ParentAccountHeader navigation={navigation} title="Children" subtitle="Family access and guardians" />
      <ScrollView contentContainerStyle={styles.content}>
        {!account.hub && account.loading ? <LoadingCard /> : null}
        {!account.hub && account.error ? <ErrorCard message={account.error} onRetry={load} /> : null}
        {account.hub && !(account.hub.children || []).length ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="people-outline" size={23} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No children linked yet</Text>
            <Text style={styles.emptyText}>Use the invitation code supplied by your center to securely connect your family.</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => navigation.navigate('ParentChildInvite')}>
              <Text style={styles.emptyButtonText}>Link a child</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {(account.hub?.children || []).map((child) => (
          <View key={child.id} style={styles.childCard}>
            <View style={styles.childHeader}>
              <View style={styles.childAvatar}>
                <Text style={styles.childAvatarText}>{initials(`${child.first_name} ${child.last_name}`)}</Text>
              </View>
              <View style={styles.childCopy}>
                <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
                <Text style={styles.childMeta}>
                  {[child.classroom_name, ageLabel(child.date_of_birth)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  family.selectChild(child.id);
                  navigation.navigate('ParentChildDetails', { childId: child.id, child });
                }}
                accessibilityRole="button"
              >
                <Text style={styles.detailsLink}>Details</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />
            <Text style={styles.guardianTitle}>GUARDIANS</Text>
            {(child.guardians || []).map((guardian) => (
              <View key={guardian.id} style={styles.guardianRow}>
                <View style={styles.guardianAvatar}>
                  <Text style={styles.guardianAvatarText}>{initials(guardian.full_name)}</Text>
                </View>
                <View style={styles.guardianCopy}>
                  <Text style={styles.guardianName}>
                    {guardian.is_current_user ? `${guardian.full_name} · you` : guardian.full_name}
                  </Text>
                  <Text style={styles.guardianMeta}>{guardian.relationship || 'Parent/guardian'}</Text>
                </View>
                {guardian.is_primary ? <Text style={styles.primaryBadge}>Primary</Text> : null}
              </View>
            ))}
            {(child.pending_invites || []).map((invite) => (
              <View key={invite.id} style={styles.guardianRow}>
                <View style={styles.pendingAvatar}><Text style={styles.pendingAvatarText}>?</Text></View>
                <View style={styles.guardianCopy}>
                  <Text style={styles.pendingName}>{invite.email}</Text>
                  <Text style={styles.guardianMeta}>
                    {invite.relationship} · pending until {shortDate(invite.expires_at)}
                  </Text>
                </View>
                {cancellingInvite === invite.id ? (
                  <ActivityIndicator size="small" color={colors.amber} />
                ) : (
                  <View style={styles.inviteActions}>
                    <TouchableOpacity onPress={() => sharePendingInvite(child, invite)} accessibilityRole="button">
                      <Text style={styles.shareLink}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmCancelInvite(invite)} accessibilityRole="button">
                      <Text style={styles.cancelInviteLink}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}

            <TouchableOpacity style={styles.inviteButton} onPress={() => setInviteChild(child)}>
              <Ionicons name="add" size={17} color={colors.primary} />
              <Text style={styles.inviteButtonText}>Invite a co-guardian</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('ParentChildInvite')}>
          <Ionicons name="link-outline" size={18} color={colors.primary} />
          <Text style={styles.linkButtonText}>Link another child</Text>
        </TouchableOpacity>
      </ScrollView>

      <InviteGuardianSheet
        visible={Boolean(inviteChild)}
        child={inviteChild}
        onClose={() => setInviteChild(null)}
        onCreated={createInvite}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingBottom: 44, gap: spacing.md },
  childCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: 18, padding: spacing.lg,
  },
  childHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  childAvatar: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight,
  },
  childAvatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 16 },
  childCopy: { flex: 1, minWidth: 0 },
  childName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  childMeta: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  detailsLink: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: spacing.md },
  guardianTitle: {
    color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5,
    letterSpacing: 0.7, marginBottom: spacing.sm,
  },
  guardianRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46 },
  guardianAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight,
  },
  guardianAvatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
  pendingAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.amberLight,
  },
  pendingAvatarText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 13 },
  guardianCopy: { flex: 1, minWidth: 0 },
  guardianName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  pendingName: { color: colors.amber, fontFamily: fonts.bold, fontSize: 13 },
  guardianMeta: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  primaryBadge: {
    color: colors.success, backgroundColor: colors.successLight,
    borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4,
    fontFamily: fonts.bold, fontSize: 10.5,
  },
  inviteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.bg, borderRadius: radius.md,
    minHeight: 44, marginTop: spacing.md,
  },
  inviteButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  linkButton: {
    minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.lg,
  },
  linkButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  inviteActions: { alignItems: 'flex-end', gap: 5 },
  shareLink: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
  cancelInviteLink: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  emptyCard: {
    alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.borderSoft, borderRadius: 18, padding: spacing.xxl,
  },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17, marginTop: spacing.md },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginTop: spacing.xs },
  emptyButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  emptyButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13.5 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.38)' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: 30,
  },
  grabber: {
    width: 42, height: 5, borderRadius: 3, alignSelf: 'center',
    backgroundColor: colors.borderStrong, marginBottom: spacing.lg,
  },
  sheetTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  sheetSubtitle: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13,
    lineHeight: 19, marginTop: spacing.xs, marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13, marginBottom: spacing.sm },
  required: { color: colors.danger },
  input: {
    minHeight: 52, backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, color: colors.textPrimary,
    fontFamily: fonts.regular, fontSize: 15,
  },
  inputError: { borderColor: colors.danger, backgroundColor: '#FDF6F6' },
  fieldError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 },
  formError: {
    color: colors.danger, backgroundColor: colors.dangerLight,
    borderRadius: radius.md, padding: spacing.md, fontFamily: fonts.regular,
    fontSize: 12.5, marginBottom: spacing.md,
  },
  primaryButton: {
    minHeight: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: radius.md,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  cancelButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  cancelButtonText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
  disabled: { opacity: 0.55 },
});
