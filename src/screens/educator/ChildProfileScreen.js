import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, Linking, ActivityIndicator
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { supabase } from '../../lib/supabase';
import { Input, Button, Divider } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';
import { colors, spacing, radius } from '../../theme';

export default function ChildProfileScreen({ route, navigation }) {
  const { child } = route.params;

  const [firstName, setFirstName] = useState(child.first_name || '');
  const [lastName, setLastName]   = useState(child.last_name  || '');
  const [dob, setDob]             = useState(child.date_of_birth || '');
  const [saving, setSaving]       = useState(false);
  const [removing, setRemoving]   = useState(false);

  // Linked parents
  const [parents, setParents]         = useState([]);
  const [loadingParents, setLoadingParents] = useState(true);

  // Invite new parent
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting]       = useState(false);

  const hasChanges =
    firstName.trim() !== (child.first_name   || '') ||
    lastName.trim()  !== (child.last_name    || '') ||
    dob              !== (child.date_of_birth || '');

  useEffect(() => { loadParents(); }, []);

  async function loadParents() {
    setLoadingParents(true);
    const { data } = await supabase
      .from('parent_children')
      .select('parent:profiles(id, full_name, email, phone)')
      .eq('child_id', child.id);
    setParents((data || []).map(r => r.parent));
    setLoadingParents(false);
  }

  async function handleSave() {
    if (!firstName.trim()) {
      Alert.alert('Required', "Please enter the child's first name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('children')
      .update({
        first_name:    firstName.trim(),
        last_name:     lastName.trim(),
        date_of_birth: dob || null,
      })
      .eq('id', child.id);
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved ✓', `${firstName.trim()}'s profile has been updated.`, [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    }
  }

  async function handleInviteParent() {
    if (!inviteEmail.trim()) {
      Alert.alert('Required', "Please enter the parent's email address.");
      return;
    }
    setInviting(true);

    // Check if user already exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('email', inviteEmail.trim().toLowerCase())
      .single();

    if (existing) {
      // Already has an account — link directly
      const { error } = await supabase
        .from('parent_children')
        .upsert({ parent_id: existing.id, child_id: child.id }, { onConflict: 'parent_id,child_id' });
      setInviting(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setInviteEmail('');
      await loadParents();
      Alert.alert('Linked ✓', `${existing.full_name} has been linked to ${child.first_name}.`);
    } else {
      // Send magic link invite
      const { error } = await supabase.auth.signInWithOtp({
        email: inviteEmail.trim().toLowerCase(),
        options: { data: { role: 'parent' }, shouldCreateUser: true },
      });
      setInviting(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setInviteEmail('');
      Alert.alert(
        'Invite sent ✓',
        `An invitation has been sent to ${inviteEmail.trim()}. Once they sign up, come back here to link them.`
      );
    }
  }

  async function handleUnlinkParent(parent) {
    Alert.alert(
      'Unlink parent',
      `Remove ${parent.full_name}'s access to ${child.first_name}'s daily logs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink', style: 'destructive',
          onPress: async () => {
            await supabase.from('parent_children')
              .delete()
              .eq('parent_id', parent.id)
              .eq('child_id', child.id);
            await loadParents();
          },
        },
      ]
    );
  }

  function handleRemove() {
    Alert.alert(
      `Remove ${child.first_name}?`,
      'This will remove them from your classroom roster. Their log history will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            await supabase.from('children').delete().eq('id', child.id);
            setRemoving(false);
            navigation.goBack();
          },
        },
      ]
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Child profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasChanges || saving}
          style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
        >
          <Text style={[styles.saveBtnText, (!hasChanges || saving) && styles.saveBtnTextDisabled]}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>
            {firstName[0] || '?'}{lastName[0] || ''}
          </Text>
        </View>
        <Text style={styles.avatarName}>{firstName} {lastName}</Text>
        {dob && <Text style={styles.avatarDob}>Born {dob}</Text>}
      </View>

      {/* Details form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Details</Text>
        <Input label="First name *" value={firstName} onChangeText={setFirstName} placeholder="e.g. Emma" />
        <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="e.g. Smith" />
        <DatePickerField label="Date of birth" value={dob} onChange={setDob} />
      </View>

      {hasChanges && (
        <Button label="Save changes" onPress={handleSave} loading={saving} style={styles.saveFullBtn} />
      )}

      {/* Linked parents */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👨‍👩‍👧 Linked parents</Text>

        {loadingParents ? (
          <ActivityIndicator color={colors.primary} />
        ) : parents.length === 0 ? (
          <Text style={styles.noParents}>No parents linked yet.</Text>
        ) : (
          parents.map((parent, i) => (
            <View key={parent.id}>
              {i > 0 && <Divider />}
              <View style={styles.parentRow}>
                <View style={styles.parentAvatar}>
                  <Text style={styles.parentInitial}>{parent.full_name?.[0] || '?'}</Text>
                </View>
                <View style={styles.parentInfo}>
                  <Text style={styles.parentName}>{parent.full_name}</Text>
                  <Text style={styles.parentEmail}>{parent.email}</Text>
                  {parent.phone ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`tel:${parent.phone}`)}
                      style={styles.phoneRow}
                    >
                      <Text style={styles.phoneIcon}>📞</Text>
                      <Text style={styles.phoneText}>{parent.phone}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.noPhone}>No phone on file</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => handleUnlinkParent(parent)}
                  style={styles.unlinkBtn}
                >
                  <Text style={styles.unlinkBtnText}>Unlink</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <Divider />

        {/* Invite / link parent */}
        <Text style={styles.inviteLabel}>Link a parent by email</Text>
        <View style={styles.inviteRow}>
          <Input
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="parent@email.com"
            keyboardType="email-address"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <TouchableOpacity
            onPress={handleInviteParent}
            disabled={inviting || !inviteEmail.trim()}
            style={[styles.inviteBtn, (!inviteEmail.trim() || inviting) && styles.inviteBtnDisabled]}
          >
            {inviting
              ? <ActivityIndicator color={colors.white} size="small" />
              : <Text style={styles.inviteBtnText}>Link</Text>
            }
          </TouchableOpacity>
        </View>
        <Text style={styles.inviteHint}>
          If they already have an account they'll be linked immediately. If not, they'll receive an invitation email.
        </Text>
      </View>

      <Divider />

      {/* Danger zone */}
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Remove from classroom</Text>
        <Text style={styles.dangerDesc}>
          Removes {firstName} from your roster. Their log history is kept and can be restored by re-adding them.
        </Text>
        <Button
          label={removing ? 'Removing...' : `Remove ${firstName}`}
          onPress={handleRemove}
          loading={removing}
          variant="danger"
          style={{ marginTop: spacing.md }}
        />
      </View>

      <View style={{ height: spacing.xxxl }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  saveBtnDisabled: { backgroundColor: colors.border },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: colors.white },
  saveBtnTextDisabled: { color: colors.textMuted },

  avatarWrap: { alignItems: 'center', marginBottom: spacing.xl },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  avatarInitial: { fontSize: 26, fontWeight: '700', color: colors.primary },
  avatarName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  avatarDob: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  saveFullBtn: { marginBottom: spacing.lg },

  noParents: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  parentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  parentAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.purpleLight, alignItems: 'center', justifyContent: 'center',
  },
  parentInitial: { fontSize: 15, fontWeight: '700', color: colors.purple },
  parentInfo: { flex: 1 },
  parentName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  parentEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  phoneIcon: { fontSize: 11 },
  phoneText: { fontSize: 12, color: colors.primary, fontWeight: '500', textDecorationLine: 'underline' },
  noPhone: { fontSize: 12, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  unlinkBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1, borderRadius: radius.full,
  },
  unlinkBtnText: { fontSize: 12, color: colors.danger, fontWeight: '500' },

  inviteLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  inviteBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', minWidth: 64,
  },
  inviteBtnDisabled: { backgroundColor: colors.border },
  inviteBtnText: { fontSize: 14, color: colors.white, fontWeight: '600' },
  inviteHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },

  dangerCard: {
    backgroundColor: colors.dangerLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.danger + '33',
    padding: spacing.lg, marginTop: spacing.sm,
  },
  dangerTitle: { fontSize: 15, fontWeight: '600', color: colors.danger, marginBottom: spacing.xs },
  dangerDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
});
