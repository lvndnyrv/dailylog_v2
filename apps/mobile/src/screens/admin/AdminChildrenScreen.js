import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { ChildAvatar } from '../../components/ChildAvatar';
import { DatePickerField } from '../../components/DatePickerField';
import { EmptyState, LoadingScreen } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

function attendanceState(record) {
  if (record?.checked_out_at) return { label: 'Departed', tone: 'neutral' };
  if (record?.checked_in_at) return { label: 'In now', tone: 'success' };
  if (record?.status === 'absent') return { label: 'Absent', tone: 'amber' };
  if (record?.status === 'late') return { label: 'Coming', tone: 'primary' };
  return { label: 'Expected', tone: 'neutral' };
}

function profileState(child, guardianCount) {
  const missing = [];
  if (!child.date_of_birth) missing.push('birth date');
  if (!Array.isArray(child.emergency_contacts) || !child.emergency_contacts.length) missing.push('emergency contact');
  if (!guardianCount) missing.push('linked guardian');
  return { complete: missing.length === 0, missing };
}

function SummaryCard({ value, label, icon, tone = 'blue' }) {
  const palette = tone === 'green'
    ? { backgroundColor: colors.successLight, color: colors.success }
    : tone === 'amber'
      ? { backgroundColor: colors.amberLight, color: colors.amber }
      : { backgroundColor: colors.primaryLight, color: colors.primary };
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: palette.backgroundColor }]}>
        <Ionicons name={icon} size={17} color={palette.color} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function AddChildSheet({ visible, onClose, onCreated, classrooms, daycareId }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [roomId, setRoomId] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function reset() {
    setFirstName('');
    setLastName('');
    setDob('');
    setRoomId('');
    setErrors({});
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  async function create() {
    const nextErrors = {};
    if (!firstName.trim()) nextErrors.firstName = 'First name is required.';
    if (!lastName.trim()) nextErrors.lastName = 'Last name is required.';
    if (!roomId) nextErrors.roomId = 'Choose a classroom.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    const { data, error } = await supabase.from('children').insert({
      daycare_id: daycareId,
      classroom_id: roomId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dob || null,
    }).select('*').single();
    setSaving(false);
    if (error) {
      Alert.alert('Could not add child', error.message);
      return;
    }
    reset();
    onClose();
    await onCreated(data);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Add a child</Text>
              <Text style={styles.sheetSubtitle}>Create the basic record, then complete contacts, medical details and family access.</Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeButton} accessibilityLabel="Close add child">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>First name <Text style={styles.required}>*</Text></Text>
          <TextInput
            value={firstName}
            onChangeText={value => { setFirstName(value); if (errors.firstName) setErrors(current => ({ ...current, firstName: null })); }}
            placeholder="e.g. Emma"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, errors.firstName && styles.inputError]}
            autoCapitalize="words"
            accessibilityLabel="First name required"
          />
          {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}

          <Text style={styles.fieldLabel}>Last name <Text style={styles.required}>*</Text></Text>
          <TextInput
            value={lastName}
            onChangeText={value => { setLastName(value); if (errors.lastName) setErrors(current => ({ ...current, lastName: null })); }}
            placeholder="e.g. Smith"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, errors.lastName && styles.inputError]}
            autoCapitalize="words"
            accessibilityLabel="Last name required"
          />
          {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}

          <DatePickerField label="Date of birth (optional)" value={dob} onChange={setDob} />

          <Text style={styles.fieldLabel}>Classroom <Text style={styles.required}>*</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomChoiceRow}>
            {classrooms.map(room => {
              const selected = room.id === roomId;
              return (
                <TouchableOpacity
                  key={room.id}
                  style={[styles.roomChoice, selected && styles.roomChoiceSelected, errors.roomId && !roomId && styles.roomChoiceError]}
                  onPress={() => { setRoomId(room.id); if (errors.roomId) setErrors(current => ({ ...current, roomId: null })); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.roomChoiceText, selected && styles.roomChoiceTextSelected]}>{room.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {errors.roomId ? <Text style={styles.errorText}>{errors.roomId}</Text> : null}

          <TouchableOpacity style={[styles.primaryButton, saving && styles.disabledButton]} onPress={create} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Add & complete profile</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ChildRow({ child, room, record, guardianCount, onPress }) {
  const attendance = attendanceState(record);
  const readiness = profileState(child, guardianCount);
  return (
    <TouchableOpacity
      style={styles.childRow}
      onPress={onPress}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={`${child.first_name} ${child.last_name}, ${room?.name || 'unassigned'}, ${attendance.label}`}
    >
      <View style={styles.avatarWrap}>
        <ChildAvatar child={child} size={46} fontSize={14} />
        {record?.checked_in_at && !record?.checked_out_at ? <View style={styles.presentDot} /> : null}
      </View>
      <View style={styles.childCopy}>
        <View style={styles.nameRow}>
          <Text style={styles.childName} numberOfLines={1}>{child.first_name} {child.last_name}</Text>
          <View style={[styles.statusChip, styles[`statusChip_${attendance.tone}`]]}>
            <Text style={[styles.statusChipText, styles[`statusText_${attendance.tone}`]]}>{attendance.label}</Text>
          </View>
        </View>
        <Text style={styles.childMeta}>{room?.name || 'No classroom'}{child.date_of_birth ? ` · Born ${format(new Date(`${child.date_of_birth}T00:00:00`), 'MMM d, yyyy')}` : ''}</Text>
        {!readiness.complete ? (
          <View style={styles.profileWarning}>
            <Ionicons name="alert-circle-outline" size={13} color={colors.amber} />
            <Text style={styles.profileWarningText} numberOfLines={1}>Needs {readiness.missing.join(', ')}</Text>
          </View>
        ) : (
          <View style={styles.profileReady}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={styles.profileReadyText}>{guardianCount} linked guardian{guardianCount === 1 ? '' : 's'}</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function AdminChildrenScreen({ navigation }) {
  const { profile } = useAuth();
  const { classrooms } = useClassroom();
  const [children, setChildren] = useState([]);
  const [records, setRecords] = useState([]);
  const [guardianCounts, setGuardianCounts] = useState({});
  const [roomFilter, setRoomFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  const rootNavigate = useCallback((name, params) => navigation.getParent()?.navigate(name, params), [navigation]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const childrenRes = await supabase.from('children')
      .select('id, first_name, last_name, date_of_birth, classroom_id, photo_url, allergies, medical_notes, emergency_contacts')
      .eq('daycare_id', profile.daycare_id)
      .is('archived_at', null)
      .order('first_name');
    if (childrenRes.error) {
      setError(childrenRes.error.message);
      setChildren([]);
      setRecords([]);
      setGuardianCounts({});
    } else {
      const rows = childrenRes.data || [];
      setChildren(rows);
      if (rows.length) {
        const ids = rows.map(child => child.id);
        const [attendanceRes, linksRes] = await Promise.all([
          supabase.from('attendance_records')
            .select('id, child_id, checked_in_at, checked_out_at, status')
            .in('child_id', ids).eq('date', today),
          supabase.from('parent_children').select('child_id, parent_id').in('child_id', ids),
        ]);
        if (attendanceRes.error || linksRes.error) setError((attendanceRes.error || linksRes.error).message);
        setRecords(attendanceRes.data || []);
        setGuardianCounts((linksRes.data || []).reduce((counts, link) => {
          counts[link.child_id] = (counts[link.child_id] || 0) + 1;
          return counts;
        }, {}));
      } else {
        setRecords([]);
        setGuardianCounts({});
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const recordByChild = useMemo(() => Object.fromEntries(records.map(record => [record.child_id, record])), [records]);
  const roomById = useMemo(() => Object.fromEntries(classrooms.map(room => [room.id, room])), [classrooms]);
  const visibleChildren = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return children.filter(child => {
      if (roomFilter !== 'all' && child.classroom_id !== roomFilter) return false;
      if (!normalized) return true;
      const roomName = roomById[child.classroom_id]?.name || '';
      return `${child.first_name} ${child.last_name} ${roomName}`.toLowerCase().includes(normalized);
    });
  }, [children, query, roomById, roomFilter]);

  const presentCount = children.filter(child => recordByChild[child.id]?.checked_in_at && !recordByChild[child.id]?.checked_out_at).length;
  const incompleteCount = children.filter(child => !profileState(child, guardianCounts[child.id] || 0).complete).length;

  async function created(child) {
    showToast(`${child.first_name}'s profile was created`, 'success');
    await load({ refresh: true });
    rootNavigate('ChildProfile', { child });
  }

  if (loading && !children.length) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>CENTER ROSTER</Text>
            <Text style={styles.pageTitle}>Children</Text>
            <Text style={styles.pageSubtitle}>Every enrolled child across all classrooms.</Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAdd(true)} accessibilityLabel="Add a child">
            <Ionicons name="person-add-outline" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <SummaryCard value={children.length} label="Enrolled" icon="people-outline" />
          <SummaryCard value={presentCount} label="In now" icon="location-outline" tone="green" />
          <SummaryCard value={classrooms.length} label="Rooms" icon="school-outline" />
          <SummaryCard value={incompleteCount} label="Need details" icon="alert-circle-outline" tone={incompleteCount ? 'amber' : 'green'} />
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={19} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search children or classrooms"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoCorrect={false}
            accessibilityLabel="Search children or classrooms"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clearButton} accessibilityLabel="Clear search">
              <Ionicons name="close" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {[{ id: 'all', name: `All · ${children.length}` }, ...classrooms].map(room => {
            const selected = roomFilter === room.id;
            const count = room.id === 'all' ? null : children.filter(child => child.classroom_id === room.id).length;
            return (
              <TouchableOpacity
                key={room.id}
                style={[styles.filterChip, selected && styles.filterChipSelected]}
                onPress={() => setRoomFilter(room.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{room.name}{count === null ? '' : ` · ${count}`}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.listHeading}>
          <Text style={styles.sectionTitle}>{roomFilter === 'all' ? 'All children' : roomById[roomFilter]?.name}</Text>
          <Text style={styles.resultCount}>{visibleChildren.length} result{visibleChildren.length === 1 ? '' : 's'}</Text>
        </View>

        {error ? (
          <TouchableOpacity style={styles.loadError} onPress={() => load({ refresh: true })}>
            <Ionicons name="cloud-offline-outline" size={19} color={colors.coral} />
            <Text style={styles.loadErrorText}>Some roster details could not refresh. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        {visibleChildren.length ? (
          <View style={styles.listCard}>
            {visibleChildren.map((child, index) => (
              <View key={child.id}>
                {index ? <View style={styles.divider} /> : null}
                <ChildRow
                  child={child}
                  room={roomById[child.classroom_id]}
                  record={recordByChild[child.id]}
                  guardianCount={guardianCounts[child.id] || 0}
                  onPress={() => rootNavigate('ChildProfile', { child })}
                />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState emoji="🔎" title="No children found" message="Try another name or classroom filter." />
        )}

        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          <Text style={styles.infoText}>Profile warnings help catch missing birth dates, emergency contacts and family access before they become an operational issue.</Text>
        </View>
      </ScrollView>

      <AddChildSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={created}
        classrooms={classrooms}
        daycareId={profile?.daycare_id}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.5, color: colors.primary },
  pageTitle: { fontFamily: fonts.bold, fontSize: 29, color: colors.textPrimary, marginTop: 2 },
  pageSubtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary, marginTop: 3 },
  addButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.primary },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: 3, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, marginBottom: 6 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 19, color: colors.textPrimary },
  summaryLabel: { fontFamily: fonts.regular, fontSize: 9.5, textAlign: 'center', color: colors.textMuted, marginTop: 2 },
  searchBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.textPrimary, paddingVertical: 0 },
  clearButton: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.background },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.md },
  filterChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterText: { fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary },
  filterTextSelected: { color: colors.white },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary },
  resultCount: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  loadError: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  loadErrorText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.coral },
  listCard: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 74, backgroundColor: colors.borderSoft },
  childRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  avatarWrap: { position: 'relative' },
  presentDot: { position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.success },
  childCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  childName: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.textPrimary },
  childMeta: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  statusChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full },
  statusChip_success: { backgroundColor: colors.successLight },
  statusChip_amber: { backgroundColor: colors.amberLight },
  statusChip_primary: { backgroundColor: colors.primaryLight },
  statusChip_neutral: { backgroundColor: colors.background },
  statusChipText: { fontFamily: fonts.bold, fontSize: 9.5 },
  statusText_success: { color: colors.success },
  statusText_amber: { color: colors.amber },
  statusText_primary: { color: colors.primary },
  statusText_neutral: { color: colors.textMuted },
  profileWarning: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  profileWarningText: { flex: 1, fontFamily: fonts.regular, fontSize: 10.5, color: colors.amber },
  profileReady: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  profileReadyText: { fontFamily: fonts.regular, fontSize: 10.5, color: colors.success },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,38,72,0.38)' },
  sheetDismiss: { flex: 1 },
  sheet: { maxHeight: '90%', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.textPrimary },
  sheetSubtitle: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.background },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary, marginBottom: 7, marginTop: spacing.sm },
  required: { color: colors.coral },
  input: { minHeight: 50, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, fontFamily: fonts.regular, fontSize: 16, color: colors.textPrimary },
  inputError: { borderColor: colors.coral, backgroundColor: colors.dangerLight },
  errorText: { fontFamily: fonts.regular, fontSize: 12, color: colors.coral, marginTop: 5 },
  roomChoiceRow: { gap: spacing.sm, paddingVertical: 2 },
  roomChoice: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface },
  roomChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roomChoiceError: { borderColor: colors.coral },
  roomChoiceText: { fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary },
  roomChoiceTextSelected: { color: colors.primary },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl },
  disabledButton: { opacity: 0.55 },
  primaryButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
