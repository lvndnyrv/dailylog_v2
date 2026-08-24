import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Alert, Linking, Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { useRoomRatios } from '../../hooks/useRoomRatios';
import { supabase } from '../../lib/supabase';
import { colors, fonts, spacing, radius } from '../../theme';
import { Button, Input, LoadingScreen, Divider } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { DatePickerField } from '../../components/DatePickerField';
import { Ionicons } from '@expo/vector-icons';


// ─── ADD CHILD BOTTOM SHEET ───────────────────────────────────────────────────
function AddChildSheet({ visible, onClose, classroomId, onAdded, onCompleteProfile }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [dob, setDob]             = useState('');
  const [saving, setSaving]       = useState(false);
  const [errors, setErrors]       = useState({});

  function validate() {
    const errs = {};
    if (!firstName.trim()) errs.firstName = 'First name is required';
    if (!lastName.trim()) errs.lastName = 'Last name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleAdd() {
    if (!validate()) return;
    if (!classroomId) {
      Alert.alert('Choose a classroom', 'Select a classroom before adding a child.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from('children').insert({
      classroom_id: classroomId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dob || null,
    }).select().single();
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await onAdded?.();
      setFirstName('');
      setLastName('');
      setDob('');
      setErrors({});
      onClose();
      onCompleteProfile(data);
    }
  }

  function handleClose() {
    setFirstName(''); setLastName(''); setDob(''); setErrors({});
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.sheetOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheetContainer}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Add a child</Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.sheetCloseButton}
              accessibilityRole="button"
              accessibilityLabel="Close add child sheet"
            >
              <Ionicons name="close" size={19} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Input
            label="First name"
            value={firstName}
            onChangeText={(v) => { setFirstName(v); if (errors.firstName) setErrors(e => ({ ...e, firstName: null })); }}
            placeholder="e.g. Emma"
            autoCapitalize="words"
            error={errors.firstName}
          />
          <Input
            label="Last name"
            value={lastName}
            onChangeText={(v) => { setLastName(v); if (errors.lastName) setErrors(e => ({ ...e, lastName: null })); }}
            placeholder="e.g. Smith"
            autoCapitalize="words"
            error={errors.lastName}
          />
          <DatePickerField
            label="Date of birth (optional)"
            value={dob}
            onChange={setDob}
          />
          <Button
            label="Add child"
            onPress={handleAdd}
            loading={saving}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function childProfileIsIncomplete(child, parentLinks) {
  const detailsComplete = Boolean(child.first_name?.trim() && child.last_name?.trim());
  const classroomComplete = Boolean(child.classroom_id);
  const medicalComplete = Boolean(child.allergies?.length || child.medical_notes?.trim());
  const contactsComplete = Array.isArray(child.emergency_contacts)
    && child.emergency_contacts.length > 0;
  const parentComplete = parentLinks.some((link) => link.child?.id === child.id);

  return !(
    detailsComplete
    && classroomComplete
    && medicalComplete
    && contactsComplete
    && parentComplete
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
          // DO NOTHING (not DO UPDATE): Phase 2 restricts UPDATE on
          // parent_children to consent_given_at only.
          { onConflict: 'parent_id,child_id', ignoreDuplicates: true }
        );
      setSending(false);
      if (error) { Alert.alert('Error', error.message); return; }
      const child = children.find(c => c.id === childId);
      Alert.alert('Linked ✓', `${existing.full_name} has been linked to ${child?.first_name}.`);
      setEmail('');
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          data: { pending_child_id: childId, role: 'parent' },
          shouldCreateUser: true,
          emailRedirectTo: 'dailylog://auth',
        },
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

      {/* Child invite code — parents can self-link with this */}
      {childId && (() => {
        const selected = children.find(c => c.id === childId);
        return selected?.invite_code ? (
          <View style={styles.codeCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Child code for {selected.first_name}</Text>
              <Text style={styles.codeValue}>{selected.invite_code}</Text>
            </View>
            <Text style={styles.codeHint}>Parent enters this{'\n'}in the app to link</Text>
          </View>
        ) : null;
      })()}

      <Input
        label="Or invite by email"
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
  const { active: activeClassroom, classrooms } = useClassroom();
  const [children, setChildren]       = useState([]);
  const [parents, setParents]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState('children');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddChild, setShowAddChild] = useState(false);
  const { rooms: ratioRooms } = useRoomRatios();
  const roomsOverRatio = ratioRooms.filter((room) => room.is_over_ratio);

  async function load(isInitial = false) {
    const roomId = activeClassroom?.id || profile?.classroom_id;
    if (!roomId) {
      setChildren([]);
      setParents([]);
      setLoading(false);
      return;
    }
    if (isInitial) setLoading(true);

    const { data: kids } = await supabase
      .from('children')
      .select('*')
      .eq('classroom_id', roomId)
      .is('archived_at', null)
      .order('first_name');

    setChildren(kids || []);

    if (kids?.length) {
      const { data: links } = await supabase
        .from('parent_children')
        .select('parent:profiles(id, full_name, email, phone), child:children(id, first_name)')
        .in('child_id', kids.map(k => k.id));
      setParents(links || []);
    } else {
      setParents([]);
    }


    setLoading(false);
  }

  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused && profile) load(true);
  }, [isFocused, profile?.classroom_id, activeClassroom?.id]);

  // Remove the old focus listener useEffect

  async function removeChild(child) {
    Alert.alert(
      'Remove child',
      `Remove ${child.first_name} ${child.last_name} from the classroom? Their log history will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          // Soft delete — archiving preserves logs, incidents and parent links
          const { error } = await supabase
            .from('children')
            .update({ archived_at: new Date().toISOString() })
            .eq('id', child.id);
          if (error) Alert.alert('Error', error.message);
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
      <Text style={styles.pageTitle}>Classroom</Text>

      <ClassroomSwitcher />

      {/* Announcements shortcut */}
      <TouchableOpacity
        style={styles.announcementsBtn}
        onPress={() => navigation.navigate('Announcements')}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open announcements"
      >
        <View style={styles.shortcutIcon}>
          <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.announcementsBtnTitle}>Announcements</Text>
          <Text style={styles.announcementsBtnSub}>Broadcast to all parents or one room</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={colors.primary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.announcementsBtn}
        onPress={() => navigation.navigate('ClassroomConsents', { classroom: activeClassroom })}
        disabled={!activeClassroom}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Open classroom consents"
      >
        <View style={styles.shortcutIcon}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.announcementsBtnTitle}>Classroom consents</Text>
          <Text style={styles.announcementsBtnSub}>See photo, trip, water and sunscreen permissions</Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color={colors.primary} />
      </TouchableOpacity>

      {/* Classroom Settings Card */}
      {activeClassroom && (
        <TouchableOpacity
          style={styles.classroomCard}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ClassroomEdit', {
            classroom: activeClassroom,
            childrenCount: children.length,
            canDelete: classrooms.length > 1,
          })}
        >
          <View style={styles.classroomCardInfo}>
            <Text style={styles.classroomCardName}>{activeClassroom.name}</Text>
            <Text style={styles.classroomCardMeta}>
              {activeClassroom.age_group || 'Age group not set'} · {children.length}{' '}
              {children.length === 1 ? 'child' : 'children'} enrolled
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.mealMenuBtn}
        onPress={() => navigation.navigate('MealMenu')}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel="Open meal menu"
      >
        <View style={styles.mealMenuIcon}>
          <Ionicons name="restaurant-outline" size={19} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mealMenuTitle}>Meal menu</Text>
          <Text style={styles.mealMenuSub}>Plan once and pre-fill every child’s meal log</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.incidentBtn}
        onPress={() => navigation.navigate('IncidentHub')}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel="Open incident reports"
      >
        <View style={styles.incidentIcon}>
          <Ionicons name="shield-checkmark-outline" size={19} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.incidentTitle}>Incident reports</Text>
          <Text style={styles.incidentSub}>Create, finish drafts, and follow director sign-off</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.ratioBtn, roomsOverRatio.length > 0 && styles.ratioBtnOver]}
        onPress={() => navigation.navigate('RoomRatios')}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel="Open room ratios"
      >
        <View style={[styles.ratioIcon, roomsOverRatio.length > 0 && styles.ratioIconOver]}>
          <Ionicons
            name={roomsOverRatio.length > 0 ? 'warning-outline' : 'people-outline'}
            size={19}
            color={roomsOverRatio.length > 0 ? colors.coral : colors.success}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.ratioTitle}>Room ratios</Text>
          <Text style={[styles.ratioSub, roomsOverRatio.length > 0 && styles.ratioSubOver]}>
            {roomsOverRatio.length > 0
              ? `${roomsOverRatio.length} ${roomsOverRatio.length === 1 ? 'room needs' : 'rooms need'} coverage`
              : 'All rooms are currently in ratio'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      {/* Tabs */}
      <View style={styles.tabs}>
        {['children', 'parents'].map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => { setTab(t); setSearchQuery(''); }}
            style={[styles.tab, tab === t && styles.tabSelected]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextSelected]}>
              {t === 'children'
                ? `Children (${children.length})`
                : `Parents (${parents.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'children' ? (
        <>
          {/* Add child button - always accessible at top */}
          <TouchableOpacity
            style={styles.addChildBtn}
            onPress={() => setShowAddChild(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={19} color={colors.primary} />
            <Text style={styles.addChildBtnText}>Add new child</Text>
          </TouchableOpacity>

          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by name…"
              placeholderTextColor={colors.textFaint}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
                <Ionicons name="close" size={13} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {children.length > 0 && (
            <View style={styles.listCard}>
              {children
                .filter(child => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase().trim();
                  return `${child.first_name} ${child.last_name}`.toLowerCase().includes(q);
                })
                .map((child, i) => {
                const isIncomplete = childProfileIsIncomplete(child, parents);
                return (
                <View key={child.id}>
                  {i > 0 && <Divider />}
                  <TouchableOpacity
                    style={styles.listRow}
                    onPress={() => navigation.navigate('ChildProfile', { child })}
                    activeOpacity={0.7}
                  >
                    <ChildAvatar child={child} size={40} />
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{child.first_name} {child.last_name}</Text>
                      {child.date_of_birth ? (
                        <Text style={styles.listSub}>Born {child.date_of_birth}</Text>
                      ) : isIncomplete ? (
                        <Text style={styles.listIncomplete}>Profile incomplete</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />
                  </TouchableOpacity>
                </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search parents or children…"
              placeholderTextColor={colors.textFaint}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
                <Ionicons name="close" size={13} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {parents.length > 0 && (
            <View style={styles.listCard}>
              {parents
                .filter(link => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase().trim();
                  const parentName = (link.parent?.full_name || '').toLowerCase();
                  const childName = (link.child?.first_name || '').toLowerCase();
                  return parentName.includes(q) || childName.includes(q);
                })
                .map((link, i) => (
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

      {/* Add child bottom sheet */}
      <AddChildSheet
        visible={showAddChild}
        onClose={() => setShowAddChild(false)}
        classroomId={activeClassroom?.id || profile.classroom_id}
        onAdded={load}
        onCompleteProfile={(child) => navigation.navigate('ChildProfile', { child })}
      />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  pageTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },

  mealMenuBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  mealMenuIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  mealMenuTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  mealMenuSub: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },
  incidentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  incidentIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.amberLight, alignItems: 'center', justifyContent: 'center',
  },
  incidentTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  incidentSub: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },
  ratioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  ratioBtnOver: { borderColor: '#F0C9BB' },
  ratioIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center',
  },
  ratioIconOver: { backgroundColor: colors.coralLight },
  ratioTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  ratioSub: {
    fontSize: 12, lineHeight: 17, fontFamily: fonts.regular,
    color: colors.success, marginTop: 1,
  },
  ratioSubOver: { color: colors.coral },

  // Announcements shortcut
  announcementsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.lg,
  },
  shortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  announcementsBtnTitle: {
    fontSize: 14.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  announcementsBtnSub: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 1,
  },
  codeCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.primary + '33',
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  codeLabel: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary },
  codeValue: { fontSize: 22, fontFamily: fonts.black, color: colors.primary, letterSpacing: 3, marginTop: 2 },
  codeHint: { fontSize: 11, fontFamily: fonts.regular, color: colors.textSecondary, textAlign: 'right', lineHeight: 15 },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, marginTop: spacing.lg },
  tab: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center',
  },
  tabSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  tabText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textSecondary },
  tabTextSelected: { color: colors.white },

  // Add child button
  addChildBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1.8, borderColor: colors.primary,
    paddingVertical: spacing.md, marginBottom: spacing.lg,
  },
  addChildBtnText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.primary },

  // Incomplete profile indicators
  listIncomplete: { fontSize: 12.5, color: colors.amber, fontFamily: fonts.bold, marginTop: 2 },

  // Bottom sheet
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetDismiss: { flex: 1 },
  sheetContainer: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 40,
  },
  sheetGrabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sheetTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  sheetCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 46,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  searchClearText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
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
  avatarText: { fontSize: 15, fontFamily: fonts.bold, color: colors.primary },
  listInfo: { flex: 1 },
  listName: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  listSub: { fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
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

  // Classroom settings card
  classroomCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.lg, marginTop: spacing.lg,
    flexDirection: 'row', alignItems: 'center',
  },
  classroomCardHeader: {
    flexDirection: 'row', alignItems: 'center',
  },
  classroomCardInfo: { flex: 1 },
  classroomCardName: { fontSize: 17, fontFamily: fonts.black, color: colors.textPrimary },
  classroomCardAge: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 3 },
  classroomCardMeta: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 3 },
  classroomCardActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  classroomChevron: { fontSize: 24, color: colors.textMuted, marginLeft: spacing.sm },
  classroomEditTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  classroomEditBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  classroomCancelBtn: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  classroomCancelBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },

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
