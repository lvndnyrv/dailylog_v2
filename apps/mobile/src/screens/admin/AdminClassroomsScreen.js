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

import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { useRoomRatios } from '../../hooks/useRoomRatios';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../components/Toast';
import { EmptyState, LoadingScreen } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function SummaryCard({ icon, value, label, tone = 'blue' }) {
  const palette = tone === 'green'
    ? { bg: colors.successLight, fg: colors.success }
    : tone === 'amber'
      ? { bg: colors.amberLight, fg: colors.amber }
      : { bg: colors.primaryLight, fg: colors.primary };
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={18} color={palette.fg} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress }) {
  return (
    <TouchableOpacity
      style={styles.quickAction}
      onPress={onPress}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.quickActionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function CreateRoomSheet({ visible, onClose, onCreated, daycareId }) {
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  function close() {
    if (saving) return;
    setName('');
    setAgeGroup('');
    setNameError('');
    onClose();
  }

  async function create() {
    if (!name.trim()) {
      setNameError('Room name is required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('classrooms')
      .insert({
        daycare_id: daycareId,
        name: name.trim(),
        age_group: ageGroup.trim() || null,
      })
      .select('id, name, age_group, capacity')
      .single();
    setSaving(false);
    if (error) {
      Alert.alert('Could not create room', error.message);
      return;
    }
    close();
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
              <Text style={styles.sheetTitle}>Add a classroom</Text>
              <Text style={styles.sheetSubtitle}>Create the room first, then add children and educators.</Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeButton} accessibilityLabel="Close add classroom">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Room name <Text style={styles.required}>*</Text></Text>
          <TextInput
            value={name}
            onChangeText={value => { setName(value); if (nameError) setNameError(''); }}
            placeholder="e.g. Preschool"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, nameError && styles.inputError]}
            autoCapitalize="words"
            accessibilityLabel="Room name required"
          />
          {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}

          <Text style={styles.fieldLabel}>Age group</Text>
          <TextInput
            value={ageGroup}
            onChangeText={setAgeGroup}
            placeholder="e.g. 3–5 years"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            accessibilityLabel="Age group"
          />

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={create}
            disabled={saving}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Create classroom</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function RoomCard({ room, ratioLoading, onOpen, onAttendance }) {
  const over = Boolean(room.is_over_ratio);
  const hostedElsewhere = room.operating?.combination_id && room.operating?.host_room_id !== room.id;
  const unavailable = !room.ratioAvailable;
  const empty = !unavailable && !hostedElsewhere && !over && Number(room.present_count) === 0;
  const neutral = unavailable || hostedElsewhere || empty;
  const educators = room.educators || [];
  const statusLabel = unavailable ? ratioLoading ? 'Checking' : 'Unavailable'
    : hostedElsewhere ? 'Combined' : over ? 'Needs coverage' : empty ? 'No children' : 'In ratio';
  const statusDetail = unavailable ? ratioLoading ? 'Checking live room counts' : 'Live room counts unavailable'
    : hostedElsewhere ? `Operating with ${room.operating?.host_room_name || 'another room'}`
      : `${room.present_count || 0} in now · ${room.staff_count || 0} staff · limit ${room.max_children_per_staff || '—'}:1`;

  return (
    <TouchableOpacity
      style={[styles.roomCard, over && styles.roomCardAlert]}
      onPress={onOpen}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={`${room.name}. ${statusLabel}. ${room.enrolled || 0} enrolled`}
    >
      <View style={styles.roomTopRow}>
        <View style={[styles.roomIcon, over && styles.roomIconAlert]}>
          <Ionicons name={over ? 'warning-outline' : 'school-outline'} size={22} color={over ? colors.coral : colors.primary} />
        </View>
        <View style={styles.roomHeadingCopy}>
          <View style={styles.roomNameRow}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            <View style={[styles.statusBadge, over ? styles.statusBadgeAlert : neutral ? styles.statusBadgeNeutral : styles.statusBadgeOk]}>
              <Text style={[styles.statusBadgeText, over ? styles.statusTextAlert : neutral ? styles.statusTextNeutral : styles.statusTextOk]}>{statusLabel}</Text>
            </View>
          </View>
          <Text style={styles.roomMeta}>{room.age_group || 'Age group not set'} · {room.enrolled || 0} enrolled</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>

      <View style={[styles.liveStrip, over && styles.liveStripAlert, neutral && styles.liveStripNeutral]}>
        <View style={styles.liveDotWrap}><View style={[styles.liveDot, over && styles.liveDotAlert, neutral && styles.liveDotNeutral]} /></View>
        <Text style={[styles.liveText, over && styles.liveTextAlert, neutral && styles.liveTextNeutral]}>{statusDetail}</Text>
      </View>

      <View style={styles.roomFooter}>
        <View style={styles.educatorStack}>
          {educators.slice(0, 3).map((educator, index) => (
            <View key={educator.id} style={[styles.educatorAvatar, index > 0 && styles.educatorOverlap]}>
              <Text style={styles.educatorInitials}>{initials(educator.full_name)}</Text>
            </View>
          ))}
          <Text style={styles.educatorLabel} numberOfLines={1}>
            {educators.length ? educators.map(item => item.full_name?.split(' ')[0]).join(', ') : 'No home-room educators'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.attendanceButton}
          onPress={event => { event.stopPropagation?.(); onAttendance(); }}
          accessibilityRole="button"
          accessibilityLabel={`Take attendance for ${room.name}`}
        >
          <Ionicons name="checkmark-circle-outline" size={17} color={colors.primary} />
          <Text style={styles.attendanceButtonText}>Attendance</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function AdminClassroomsScreen({ navigation }) {
  const { profile } = useAuth();
  const classroom = useClassroom();
  const ratioState = useRoomRatios();
  const [childCounts, setChildCounts] = useState({});
  const [educatorsByRoom, setEducatorsByRoom] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const rootNavigate = useCallback((name, params) => {
    navigation.getParent()?.navigate(name, params);
  }, [navigation]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile?.daycare_id) return;
    if (!quiet) setLoading(true);
    setError('');
    const [childrenRes, staffRes] = await Promise.all([
      supabase.from('children').select('id, classroom_id')
        .eq('daycare_id', profile.daycare_id).is('archived_at', null),
      supabase.from('staff_members')
        .select('id, profile:profiles(id, full_name, classroom_id)')
        .eq('daycare_id', profile.daycare_id).eq('status', 'active'),
    ]);
    const loadError = childrenRes.error || staffRes.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      setChildCounts((childrenRes.data || []).reduce((counts, child) => {
        if (child.classroom_id) counts[child.classroom_id] = (counts[child.classroom_id] || 0) + 1;
        return counts;
      }, {}));
      setEducatorsByRoom((staffRes.data || []).reduce((groups, member) => {
        const staffProfile = Array.isArray(member.profile) ? member.profile[0] : member.profile;
        if (!staffProfile?.classroom_id) return groups;
        groups[staffProfile.classroom_id] = [...(groups[staffProfile.classroom_id] || []), {
          id: member.id,
          full_name: staffProfile.full_name,
        }];
        return groups;
      }, {}));
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useFocusEffect(useCallback(() => {
    load();
    classroom.reload?.();
    ratioState.load({ quiet: true });
  }, [load]));

  const rooms = useMemo(() => classroom.classrooms.map(room => {
    const live = ratioState.rooms.find(item => item.id === room.id);
    return {
      ...room,
      ...live,
      ratioAvailable: Boolean(live),
      enrolled: childCounts[room.id] || 0,
      educators: educatorsByRoom[room.id] || [],
    };
  }), [childCounts, classroom.classrooms, educatorsByRoom, ratioState.rooms]);

  const totalChildren = rooms.reduce((sum, room) => sum + room.enrolled, 0);
  const overRatio = rooms.filter(room => room.is_over_ratio).length;
  const occupiedRooms = rooms.filter(room => room.ratioAvailable && Number(room.present_count) > 0);
  const inRatio = occupiedRooms.filter(room => !room.is_over_ratio).length;
  const ratiosReady = !ratioState.loading && !ratioState.error && rooms.every(room => room.ratioAvailable);
  const present = rooms.reduce((sum, room) => sum + Number(room.present_count || 0), 0);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([load({ quiet: true }), classroom.reload?.(), ratioState.load({ quiet: true })]);
    setRefreshing(false);
  }

  async function openRoom(room) {
    await classroom.switchClassroom(room.id);
    rootNavigate('AdminRoom', { roomId: room.id, roomName: room.name });
  }

  async function openAttendance(room) {
    await classroom.switchClassroom(room.id);
    rootNavigate('RollCall', { classroomId: room.id, classroomName: room.name });
  }

  async function roomCreated(room) {
    await classroom.reload?.();
    showToast(`${room.name} was created`, 'success');
  }

  if (loading && !rooms.length) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>CENTER OPERATIONS</Text>
            <Text style={styles.pageTitle}>Classrooms</Text>
            <Text style={styles.pageSubtitle}>Enrollment, live ratios and room teams in one place.</Text>
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowCreate(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a classroom"
          >
            <Ionicons name="add" size={21} color={colors.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard icon="school-outline" value={rooms.length} label="Rooms" />
          <SummaryCard icon="people-outline" value={totalChildren} label="Enrolled" tone="green" />
          <SummaryCard icon="location-outline" value={ratiosReady ? present : '—'} label="In now" tone="blue" />
          <SummaryCard icon={overRatio ? 'warning-outline' : 'shield-checkmark-outline'}
            value={ratiosReady ? overRatio || (occupiedRooms.length ? inRatio : '—') : '—'}
            label={!ratiosReady ? ratioState.loading ? 'Checking ratio' : 'Ratio unavailable' : overRatio ? 'Need help' : occupiedRooms.length ? 'In ratio' : 'No children yet'}
            tone={overRatio ? 'amber' : ratiosReady && occupiedRooms.length ? 'green' : 'blue'} />
        </View>

        <Text style={styles.sectionTitle}>Center tools</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActions}>
          <QuickAction icon="checkmark-done-outline" label="Attendance" onPress={() => rootNavigate('AdminAttendance')} />
          <QuickAction icon="git-compare-outline" label="Ratios" onPress={() => rootNavigate('RoomRatios')} />
          <QuickAction icon="restaurant-outline" label="Meal menu" onPress={() => rootNavigate('MealMenu')} />
          <QuickAction icon="megaphone-outline" label="Announcements" onPress={() => rootNavigate('Announcements')} />
        </ScrollView>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>All rooms</Text>
          <Text style={styles.sectionHint}>Tap a room to manage it</Text>
        </View>

        {error ? (
          <TouchableOpacity style={styles.errorCard} onPress={refresh}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.coral} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>Could not refresh classrooms</Text>
              <Text style={styles.errorCopy}>{error} · Tap to retry.</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {rooms.length ? rooms.map(room => (
          <RoomCard
            key={room.id}
            room={room}
            ratioLoading={ratioState.loading}
            onOpen={() => openRoom(room)}
            onAttendance={() => openAttendance(room)}
          />
        )) : (
          <EmptyState
            emoji="🏫"
            title="No classrooms yet"
            message="Create your first classroom to begin enrolling children and assigning educators."
          />
        )}

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
          <Text style={styles.infoText}>Live counts come from child check-ins and staff clock-ins. Ratio changes update automatically.</Text>
        </View>
      </ScrollView>

      <CreateRoomSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={roomCreated}
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
  pageSubtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 3 },
  addButton: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  summaryGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  summaryCard: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary },
  summaryLabel: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary },
  sectionHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted },
  quickActions: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  quickAction: { width: 94, alignItems: 'center', gap: 7, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  quickActionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primaryLight },
  quickActionLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.textPrimary },
  roomCard: { padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  roomCardAlert: { borderColor: '#F0C9C9' },
  roomTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  roomIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  roomIconAlert: { backgroundColor: colors.dangerLight },
  roomHeadingCopy: { flex: 1, minWidth: 0 },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roomName: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary },
  roomMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full },
  statusBadgeOk: { backgroundColor: colors.successLight },
  statusBadgeAlert: { backgroundColor: colors.dangerLight },
  statusBadgeNeutral: { backgroundColor: colors.primarySoft },
  statusBadgeText: { fontFamily: fonts.bold, fontSize: 10 },
  statusTextOk: { color: colors.success },
  statusTextAlert: { color: colors.coral },
  statusTextNeutral: { color: colors.textMuted },
  liveStrip: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.successLight },
  liveStripAlert: { backgroundColor: colors.dangerLight },
  liveStripNeutral: { backgroundColor: colors.primarySoft },
  liveDotWrap: { width: 12, alignItems: 'center' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveDotAlert: { backgroundColor: colors.coral },
  liveDotNeutral: { backgroundColor: colors.textFaint },
  liveText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.success },
  liveTextAlert: { color: colors.coral },
  liveTextNeutral: { color: colors.textMuted },
  roomFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  educatorStack: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  educatorAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.primaryLight },
  educatorOverlap: { marginLeft: -7 },
  educatorInitials: { fontFamily: fonts.bold, fontSize: 9, color: colors.primary },
  educatorLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted, marginLeft: 7 },
  attendanceButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  attendanceButtonText: { fontFamily: fonts.bold, fontSize: 11, color: colors.primary },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.coral },
  errorCopy: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 2 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,38,72,0.38)' },
  sheetDismiss: { flex: 1 },
  sheet: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.xl },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.textPrimary },
  sheetSubtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 4 },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.background },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary, marginBottom: 7, marginTop: spacing.sm },
  required: { color: colors.coral },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, fontFamily: fonts.regular, fontSize: 16, color: colors.textPrimary },
  inputError: { borderColor: colors.coral, backgroundColor: colors.dangerLight },
  errorText: { fontFamily: fonts.regular, fontSize: 12, color: colors.coral, marginTop: 5 },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl },
  disabledButton: { opacity: 0.55 },
  primaryButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
