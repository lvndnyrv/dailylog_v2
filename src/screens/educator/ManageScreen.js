import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, Linking
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';
import { Button, Input, LoadingScreen, Divider } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';


// ─── ADD CHILD FORM ───────────────────────────────────────────────────────────
function AddChildForm({ classroomId, onAdded }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [dob, setDob]             = useState('');
  const [saving, setSaving]       = useState(false);

  async function handleAdd() {
    if (!firstName.trim()) {
      Alert.alert('Required', "Please enter the child's first name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('children').insert({
      classroom_id: classroomId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dob || null,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setFirstName(''); setLastName(''); setDob('');
      onAdded();
    }
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>Add a child</Text>
      <Input
        label="First name *"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="e.g. Emma"
      />
      <Input
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="e.g. Smith"
      />
      <DatePickerField
        label="Date of birth (optional)"
        value={dob}
        onChange={setDob}
      />
      <Button label="Add child" onPress={handleAdd} loading={saving} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

// ─── INVITE PARENT FORM ───────────────────────────────────────────────────────
function InviteParentForm({ classroomId, children }) {
  const [email, setEmail]     = useState('');
  const [childId, setChildId] = useState(children[0]?.id || '');
  const [sending, setSending] = useState(false);

  async function handleInvite() {
    if (!email.trim()) {
      Alert.alert('Required', "Please enter the parent's email address.");
      return;
    }
    if (!childId) {
      Alert.alert('Required', 'Please select a child to link this parent to.');
      return;
    }
    setSending(true);

    const { data: existing } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (existing) {
      const { error } = await supabase
        .from('parent_children')
        .upsert(
          { parent_id: existing.id, child_id: childId },
          { onConflict: 'parent_id,child_id' }
        );
      setSending(false);
      if (error) { Alert.alert('Error', error.message); return; }
      const child = children.find(c => c.id === childId);
      Alert.alert('Linked ✓', `${existing.full_name} has been linked to ${child?.first_name}.`);
      setEmail('');
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { data: { pending_child_id: childId, role: 'parent' }, shouldCreateUser: true },
      });
      setSending(false);
      if (error) { Alert.alert('Error', error.message); return; }
      const child = children.find(c => c.id === childId);
      Alert.alert(
        'Invite sent ✓',
        `An invitation email has been sent to ${email.trim()}.\n\nOnce they sign up, link them to ${child?.first_name} from this screen.`
      );
      setEmail('');
    }
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>Invite a parent</Text>

      <Text style={styles.fieldLabel}>Link to child</Text>
      <View style={styles.childPicker}>
        {children.map(c => (
          <TouchableOpacity
            key={c.id}
            onPress={() => setChildId(c.id)}
            style={[styles.childPickerBtn, c.id === childId && styles.childPickerBtnSelected]}
          >
            <Text style={[styles.childPickerText, c.id === childId && { color: colors.primary, fontWeight: '600' }]}>
              {c.first_name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input
        label="Parent's email address"
        value={email}
        onChangeText={setEmail}
        placeholder="parent@email.com"
        keyboardType="email-address"
      />
      <Button label="Send invite" onPress={handleInvite} loading={sending} />
    </View>
  );
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────
export default function ManageScreen({ navigation }) {
  const { profile }                   = useAuth();
  const [children, setChildren]       = useState([]);
  const [parents, setParents]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState('children');

  async function load() {
    if (!profile?.classroom_id) return;
    setLoading(true);

    const { data: kids } = await supabase
      .from('children')
      .select('*')
      .eq('classroom_id', profile.classroom_id)
      .order('first_name');

    setChildren(kids || []);

    if (kids?.length) {
      const { data: links } = await supabase
        .from('parent_children')
        .select('parent:profiles(id, full_name, email, phone), child:children(id, first_name)')
        .in('child_id', kids.map(k => k.id));
      setParents(links || []);
    }

    setLoading(false);
  }

  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused && profile) load();
  }, [isFocused, profile]);

  // Remove the old focus listener useEffect

  async function removeChild(child) {
    Alert.alert(
      'Remove child',
      `Remove ${child.first_name} ${child.last_name} from the classroom? Their log history will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('children').delete().eq('id', child.id);
          load();
        }},
      ]
    );
  }

  async function unlinkParent(parentId, childId) {
    Alert.alert("Unlink parent", "Remove this parent's access to this child?", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: async () => {
        await supabase.from('parent_children').delete().eq('parent_id', parentId).eq('child_id', childId);
        load();
      }},
    ]);
  }

  if (loading) return <LoadingScreen />;

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pageTitle}>Manage classroom</Text>

      {/* Tabs */}
      <View style={styles.tabs}>
        {['children', 'parents'].map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabSelected]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextSelected]}>
              {t === 'children'
                ? `👧 Children (${children.length})`
                : `👨‍👩‍👧 Parents (${parents.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'children' ? (
        <>
          {children.length > 0 && (
            <View style={styles.listCard}>
              {children.map((child, i) => (
                <View key={child.id}>
                  {i > 0 && <Divider />}
                  <TouchableOpacity
                    style={styles.listRow}
                    onPress={() => navigation.navigate('ChildProfile', { child })}
                    activeOpacity={0.7}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{child.first_name[0]}{child.last_name?.[0] || ''}</Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{child.first_name} {child.last_name}</Text>
                      {child.date_of_birth && (
                        <Text style={styles.listSub}>Born {child.date_of_birth}</Text>
                      )}
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <AddChildForm classroomId={profile.classroom_id} onAdded={load} />
        </>
      ) : (
        <>
          {parents.length > 0 && (
            <View style={styles.listCard}>
              {parents.map((link, i) => (
                <View key={`${link.parent?.id}-${link.child?.id}`}>
                  {i > 0 && <Divider />}
                  <View style={styles.listRow}>
                    <View style={[styles.avatar, { backgroundColor: colors.purpleLight }]}>
                      <Text style={[styles.avatarText, { color: colors.purple }]}>
                        {link.parent?.full_name?.[0] || '?'}
                      </Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{link.parent?.full_name}</Text>
                      <Text style={styles.listSub}>
                        {link.parent?.email} · {link.child?.first_name}
                      </Text>
                      {link.parent?.phone ? (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(`tel:${link.parent.phone}`)}
                          style={styles.callRow}
                        >
                          <Text style={styles.callIcon}>📞</Text>
                          <Text style={styles.callText}>{link.parent.phone}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.noPhone}>No phone on file</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => unlinkParent(link.parent?.id, link.child?.id)}
                      style={styles.removeBtn}
                    >
                      <Text style={styles.removeBtnText}>Unlink</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
          {children.length > 0
            ? <InviteParentForm classroomId={profile.classroom_id} children={children} />
            : <Text style={styles.emptyNote}>Add children first before inviting parents.</Text>
          }
        </>
      )}

      <View style={{ height: spacing.xxxl }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  tab: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center',
  },
  tabSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tabText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  tabTextSelected: { color: colors.primary },
  listCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.lg, overflow: 'hidden',
  },
  listRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  listInfo: { flex: 1 },
  listName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  listSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  callIcon: { fontSize: 12 },
  callText: { fontSize: 13, color: colors.primary, fontWeight: '500', textDecorationLine: 'underline' },
  noPhone: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },
  removeBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2, borderRadius: radius.full,
  },
  removeBtnText: { fontSize: 12, color: colors.danger, fontWeight: '500' },
  formCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  formTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  childPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  childPickerBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  childPickerBtnSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  childPickerText: { fontSize: 14, color: colors.textSecondary },
  emptyNote: { fontSize: 14, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },

  // Date picker
  inputWrap: { marginBottom: spacing.md },
  inputLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.xs },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  dateBtnText: { fontSize: 15, color: colors.textPrimary },
  dateBtnPlaceholder: { fontSize: 15, color: colors.textMuted },
  dateBtnIcon: { fontSize: 16 },
  dateOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  dateSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  dateSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  dateTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  dateCancel: { fontSize: 16, color: colors.textSecondary },
  dateDone: { fontSize: 16, color: colors.primary, fontWeight: '600' },
});
