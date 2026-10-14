import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useRoomEditAccess } from '../../hooks/useRoomEditAccess';
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

function CreateRoomSheet({ visible, daycareId, onClose, onCreated, onRefresh }) {
  const [values, setValues] = useState({
    name: '', age_group: '', min_age_months: '', max_age_months: '', capacity: '', ratio: '',
  });
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [errors, setErrors] = useState({});

  function change(key, value) {
    if (saveUncertain) return;
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: '' }));
    setSaveNotice('');
  }

  function reset() {
    setValues({ name: '', age_group: '', min_age_months: '', max_age_months: '', capacity: '', ratio: '' });
    setErrors({});
    setSaveUncertain(false);
    setSaveNotice('');
  }

  function close() {
    if (saving || verifying) return;
    const shouldRefresh = saveUncertain;
    reset();
    onClose();
    if (shouldRefresh) onRefresh();
  }

  async function verifySave() {
    if (!saveUncertain || !daycareId || verifying) return;
    setVerifying(true);
    let data;
    let error;
    try {
      ({ data, error } = await supabase.from('classrooms')
        .select('id, name, age_group, min_age_months, max_age_months, capacity, ratio_children_per_educator')
        .eq('daycare_id', daycareId).is('archived_at', null));
    } catch (caughtError) {
      error = caughtError;
    }
    setVerifying(false);
    if (error) {
      setSaveNotice('Could not check the classroom list. Check your connection and try again.');
      return;
    }
    const namedRoom = (data || []).find(room => room.name?.trim().toLowerCase() === values.name.trim().toLowerCase());
    if (!namedRoom) {
      setSaveUncertain(false);
      setSaveNotice('No classroom with this name was found. You can try saving again.');
      return;
    }
    const matches = namedRoom.age_group?.trim() === values.age_group.trim()
      && Number(namedRoom.min_age_months) === Number(values.min_age_months)
      && Number(namedRoom.max_age_months) === Number(values.max_age_months)
      && Number(namedRoom.capacity) === Number(values.capacity)
      && Number(namedRoom.ratio_children_per_educator) === Number(values.ratio);
    if (!matches) {
      setSaveNotice('A classroom with this name exists, but its details differ. Close this form and review it in the classroom list.');
      return;
    }
    const roomName = namedRoom.name;
    reset();
    onClose();
    await onCreated({ id: namedRoom.id, name: roomName }, { verified: true });
  }

  async function create() {
    if (saving || verifying || saveUncertain) return;
    const nextErrors = {};
    if (!values.name.trim() || values.name.trim().length > 100) nextErrors.name = 'Enter a room name (up to 100 characters).';
    if (!values.age_group.trim() || values.age_group.trim().length > 100) nextErrors.age_group = 'Enter an age-band name (up to 100 characters).';
    for (const [key, min, max] of [
      ['min_age_months', 0, 215], ['max_age_months', 1, 216],
      ['capacity', 1, 9999], ['ratio', 1, 999],
    ]) {
      if (!/^\d+$/.test(values[key]) || Number(values[key]) < min || Number(values[key]) > max) {
        nextErrors[key] = `Enter a whole number from ${min} to ${max}.`;
      }
    }
    if (!nextErrors.min_age_months && !nextErrors.max_age_months &&
      Number(values.max_age_months) <= Number(values.min_age_months)) {
      nextErrors.max_age_months = 'Oldest age must be after youngest age.';
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaveNotice('');
    setSaving(true);
    let roomId;
    try {
      const { data, error } = await supabase.rpc('save_room_settings', {
        p_room_id: null,
        p_expected_updated_at: null,
        p_settings: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])),
      });
      if (error) throw error;
      if (!data) throw new Error('The room save returned no room ID.');
      roomId = data;
    } catch (error) {
      setSaveUncertain(true);
      setSaveNotice('We could not confirm whether the classroom was saved. Check the classroom list before trying again.');
      setSaving(false);
      return;
    }
    setSaving(false);
    const roomName = values.name.trim();
    reset();
    onClose();
    await onCreated({ id: roomId, name: roomName });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={close} />
        <View style={[styles.sheet, styles.createSheet]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Add a classroom</Text>
              <Text style={styles.sheetSubtitle}>Set the age band, capacity and ratio before adding children or educators.</Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeButton} accessibilityLabel="Close add classroom">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {[
              ['name', 'Room name', 'e.g. Preschool', false],
              ['age_group', 'Age-band name', 'e.g. Preschool', false],
              ['min_age_months', 'Youngest age (months)', 'e.g. 36', true],
              ['max_age_months', 'Oldest age (months)', 'e.g. 60', true],
              ['capacity', 'Capacity', 'e.g. 16', true],
              ['ratio', 'Children per educator', 'e.g. 8', true],
            ].map(([key, label, placeholder, numeric]) => (
              <View key={key}>
                <Text style={styles.fieldLabel}>{label} <Text style={styles.required}>*</Text></Text>
                <TextInput
                  value={values[key]}
                  onChangeText={value => change(key, value)}
                  placeholder={placeholder}
                  placeholderTextColor={colors.textFaint}
                  style={[styles.input, errors[key] && styles.inputError]}
                  editable={!saving && !verifying && !saveUncertain}
                  keyboardType={numeric ? 'number-pad' : 'default'}
                  autoCapitalize={numeric ? 'none' : 'words'}
                  accessibilityLabel={`${label} required`}
                />
                {errors[key] ? <Text style={styles.errorText}>{errors[key]}</Text> : null}
              </View>
            ))}
            <Text style={styles.sheetSubtitle}>These are center-configured values, not verified licensing limits. Confirm them against your center’s requirements before saving.</Text>
            {saveNotice ? <View style={styles.saveNotice}>
              <Ionicons name="information-circle-outline" size={18} color={colors.amber} />
              <Text style={styles.saveNoticeText}>{saveNotice}</Text>
            </View> : null}
            <TouchableOpacity
              style={[styles.primaryButton, (saving || verifying) && styles.disabledButton]}
              onPress={saveUncertain ? verifySave : create}
              disabled={saving || verifying}
              accessibilityRole="button"
              accessibilityLabel={saveUncertain ? 'Check classroom list before saving again' : 'Create classroom'}
            >
              {saving || verifying ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.primaryButtonText}>{saveUncertain ? 'Check classroom list' : 'Create classroom'}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function RoomCard({ room, ratioLoading, onOpen, onAttendance }) {
  const over = Boolean(room.is_over_ratio);
  const hostedElsewhere = room.operating?.combination_id && room.operating?.host_room_id !== room.id;
  const unavailable = !room.ratioAvailable;
  const ruleMissing = !unavailable && room.operating?.live_ratio == null;
  const empty = !unavailable && !hostedElsewhere && !over && Number(room.present_count) === 0;
  const neutral = unavailable || hostedElsewhere || ruleMissing || empty;
  const educators = room.educators || [];
  const statusLabel = unavailable ? ratioLoading ? 'Checking' : 'Unavailable'
    : hostedElsewhere ? 'Combined' : ruleMissing ? 'Rule not set' : over ? 'Needs coverage' : empty ? 'No children' : 'In ratio';
  const statusDetail = unavailable ? ratioLoading ? 'Checking live room counts' : 'Live room counts unavailable'
    : hostedElsewhere ? `Operating with ${room.operating?.host_room_name || 'another room'}`
      : ruleMissing ? `${room.present_count || 0} in now · ${room.staff_count || 0} staff · set a ratio rule`
      : `${room.present_count || 0} in now · ${room.staff_count || 0} staff · limit ${room.max_children_per_staff || '—'}:1`;

  return (
    <TouchableOpacity
      style={[styles.roomCard, over && !ruleMissing && styles.roomCardAlert]}
      onPress={onOpen}
      activeOpacity={0.76}
      accessibilityRole="button"
      accessibilityLabel={`${room.name}. ${statusLabel}. ${room.enrolled || 0} enrolled`}
    >
      <View style={styles.roomTopRow}>
        <View style={[styles.roomIcon, over && !ruleMissing && styles.roomIconAlert]}>
          <Ionicons name={over || ruleMissing ? 'warning-outline' : 'school-outline'} size={22} color={over && !ruleMissing ? colors.coral : colors.primary} />
        </View>
        <View style={styles.roomHeadingCopy}>
          <View style={styles.roomNameRow}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            <View style={[styles.statusBadge, ruleMissing ? styles.statusBadgeNeutral : over ? styles.statusBadgeAlert : neutral ? styles.statusBadgeNeutral : styles.statusBadgeOk]}>
              <Text style={[styles.statusBadgeText, ruleMissing ? styles.statusTextNeutral : over ? styles.statusTextAlert : neutral ? styles.statusTextNeutral : styles.statusTextOk]}>{statusLabel}</Text>
            </View>
          </View>
          <Text style={styles.roomMeta}>{room.age_group || 'Age group not set'} · {room.enrolled || 0} enrolled</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </View>

      <View style={[styles.liveStrip, over && !ruleMissing && styles.liveStripAlert, neutral && styles.liveStripNeutral]}>
        <View style={styles.liveDotWrap}><View style={[styles.liveDot, over && !ruleMissing && styles.liveDotAlert, neutral && styles.liveDotNeutral]} /></View>
        <Text style={[styles.liveText, over && !ruleMissing && styles.liveTextAlert, neutral && styles.liveTextNeutral]}>{statusDetail}</Text>
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

export default function AdminClassroomsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const classroom = useClassroom();
  const { canEditRooms, roomEditAccessReady, roomEditAccessError, refreshRoomEditAccess } = useRoomEditAccess();
  const ratioState = useRoomRatios();
  const [childCounts, setChildCounts] = useState({});
  const [educatorsByRoom, setEducatorsByRoom] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const loadRequest = useRef(0);

  useEffect(() => {
    if (!route?.params?.openCreateRoom || !roomEditAccessReady) return;
    if (canEditRooms) setShowCreate(true);
    else showToast(roomEditAccessError
      ? 'Could not verify room-edit access. Refresh and try again.'
      : 'Your account cannot add classrooms.', 'error');
    navigation.setParams({ openCreateRoom: undefined });
  }, [navigation, route?.params?.openCreateRoom, roomEditAccessReady, canEditRooms, roomEditAccessError]);

  useEffect(() => {
    if (roomEditAccessReady && !canEditRooms) setShowCreate(false);
  }, [roomEditAccessReady, canEditRooms]);

  const rootNavigate = useCallback((name, params) => {
    navigation.getParent()?.navigate(name, params);
  }, [navigation]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile?.daycare_id) return;
    const request = ++loadRequest.current;
    if (!quiet) setLoading(true);
    setError('');
    const [childrenRes, staffRes] = await Promise.all([
      supabase.from('children').select('id, classroom_id')
        .eq('daycare_id', profile.daycare_id).is('archived_at', null),
      supabase.from('staff_members')
        .select('id, profile:profiles(id, full_name, classroom_id, daycare_id, role, archived_at)')
        .eq('daycare_id', profile.daycare_id).eq('status', 'active').is('archived_at', null),
    ]);
    if (request !== loadRequest.current) return;
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
        if (staffProfile?.role !== 'educator' || staffProfile.archived_at ||
            staffProfile.daycare_id !== profile.daycare_id || !staffProfile.classroom_id) return groups;
        groups[staffProfile.classroom_id] = [...(groups[staffProfile.classroom_id] || []), {
          id: member.id,
          full_name: staffProfile.full_name || 'Educator',
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
    return () => { loadRequest.current += 1; };
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
  const missingRules = rooms.filter(room => room.ratioAvailable && room.operating?.live_ratio == null).length;
  const overRatio = rooms.filter(room => room.is_over_ratio && room.operating?.live_ratio != null).length;
  const occupiedRooms = rooms.filter(room => room.ratioAvailable && Number(room.present_count) > 0);
  const inRatio = occupiedRooms.filter(room => room.operating?.live_ratio != null && !room.is_over_ratio).length;
  const ratiosReady = !ratioState.loading && !ratioState.error && rooms.every(room => room.ratioAvailable);
  const present = rooms.reduce((sum, room) => sum + Number(room.present_count || 0), 0);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([load({ quiet: true }), classroom.reload?.(), ratioState.load({ quiet: true }), refreshRoomEditAccess()]);
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

  async function roomCreated(room, { verified = false } = {}) {
    await Promise.all([classroom.reload?.(), ratioState.load({ quiet: true })]);
    showToast(verified ? `${room.name} is already on the classroom list` : `${room.name} was created`, 'success');
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
          {canEditRooms ? <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowCreate(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a classroom"
          >
            <Ionicons name="add" size={21} color={colors.white} />
          </TouchableOpacity> : null}
        </View>

        <View style={styles.summaryGrid}>
          <SummaryCard icon="school-outline" value={rooms.length} label="Rooms" />
          <SummaryCard icon="people-outline" value={totalChildren} label="Enrolled" tone="green" />
          <SummaryCard icon="location-outline" value={ratiosReady ? present : '—'} label="In now" tone="blue" />
          <SummaryCard icon={overRatio || missingRules ? 'warning-outline' : 'shield-checkmark-outline'}
            value={ratiosReady ? overRatio || missingRules || (occupiedRooms.length ? inRatio : '—') : '—'}
            label={!ratiosReady ? ratioState.loading ? 'Checking ratio' : 'Ratio unavailable' : overRatio ? 'Need help' : missingRules ? 'Rule not set' : occupiedRooms.length ? 'In ratio' : 'No children yet'}
            tone={overRatio || missingRules ? 'amber' : ratiosReady && occupiedRooms.length ? 'green' : 'blue'} />
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
          <Text style={styles.sectionHint}>Tap a room to view it</Text>
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

        {roomEditAccessReady && !canEditRooms ? (
          <TouchableOpacity style={styles.infoCard} disabled={!roomEditAccessError}
            onPress={refreshRoomEditAccess} accessibilityRole={roomEditAccessError ? 'button' : 'text'}>
            <Ionicons name="lock-closed-outline" size={19} color={colors.primary} />
            <Text style={styles.infoText}>{roomEditAccessError
              ? 'Could not verify room-edit access. Tap to retry.'
              : 'Your account can view classrooms. An owner can grant room-edit access to add or change them.'}</Text>
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
            message={!roomEditAccessReady
              ? 'Checking room access…'
              : canEditRooms
                ? 'Create your first classroom to begin enrolling children and assigning educators.'
                : 'Ask an administrator with room-edit access to create the first classroom.'}
          />
        )}

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
          <Text style={styles.infoText}>Live counts come from child check-ins and staff clock-ins. Ratio changes update automatically.</Text>
        </View>
      </ScrollView>

      <CreateRoomSheet
        visible={showCreate && canEditRooms}
        daycareId={profile?.daycare_id}
        onClose={() => setShowCreate(false)}
        onCreated={roomCreated}
        onRefresh={refresh}
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
  createSheet: { maxHeight: '88%' },
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
  saveNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberLight },
  saveNoticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl },
  disabledButton: { opacity: 0.55 },
  primaryButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
