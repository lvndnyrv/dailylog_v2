import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { useRoomRatios } from '../../hooks/useRoomRatios';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function statusFor(record) {
  if (record?.checked_in_at && record?.checked_out_at) return 'departed';
  if (record?.checked_in_at) return 'present';
  if (record?.status === 'absent' || record?.status === 'excused') return 'absent';
  if (record?.status === 'late') return 'coming';
  return 'awaited';
}

function SummaryCard({ label, value, icon, tone }) {
  const color = tone === 'success' ? colors.success : tone === 'amber' ? colors.amber : tone === 'purple' ? colors.purple : colors.primary;
  const background = tone === 'success' ? colors.successLight : tone === 'amber' ? colors.amberLight : tone === 'purple' ? colors.purpleLight : colors.primaryLight;
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: background }]}><Ionicons name={icon} size={17} color={color} /></View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function RoomRow({ room, counts, ratio, ratioLoading, busy, onPress }) {
  const needsFollowup = counts.awaited + counts.coming;
  const isOver = Boolean(ratio?.is_over_ratio);
  const hostedElsewhere = ratio?.operating?.combination_id && ratio.operating.host_room_id !== room.id;
  const ruleMissing = Boolean(ratio) && ratio.operating?.live_ratio == null;
  const empty = Boolean(ratio) && !hostedElsewhere && !isOver && Number(ratio.present_count) === 0;
  const neutral = !ratio || hostedElsewhere || ruleMissing || empty;
  const ratioStatus = !ratio ? ratioLoading ? 'Checking' : 'Unavailable'
    : hostedElsewhere ? 'Combined' : ruleMissing ? 'Rule not set' : isOver ? 'Over ratio' : empty ? 'No children' : 'In ratio';
  return (
    <TouchableOpacity
      style={[styles.roomCard, isOver && !ruleMissing && styles.roomCardAlert]}
      onPress={onPress}
      activeOpacity={0.74}
      accessibilityRole="button"
      accessibilityLabel={`${room.name}. ${counts.present} in, ${counts.absent} absent, ${needsFollowup} awaited. Ratio ${ratioStatus.toLowerCase()}.`}
    >
      <View style={[styles.roomIcon, isOver && !ruleMissing && styles.roomIconAlert]}>
        <Ionicons name={isOver || ruleMissing ? 'warning-outline' : 'home-outline'} size={21} color={isOver && !ruleMissing ? colors.danger : colors.primary} />
      </View>
      <View style={styles.roomCopy}>
        <View style={styles.roomTitleRow}>
          <Text style={styles.roomName}>{room.name}</Text>
          <View style={[styles.ratioBadge, ruleMissing ? styles.ratioBadgeNeutral : isOver ? styles.ratioBadgeAlert : neutral ? styles.ratioBadgeNeutral : styles.ratioBadgeOk]}>
            <Text style={[styles.ratioText, ruleMissing ? styles.ratioTextNeutral : isOver ? styles.ratioTextAlert : neutral ? styles.ratioTextNeutral : styles.ratioTextOk]}>{ratioStatus}</Text>
          </View>
        </View>
        <Text style={styles.roomMeta}>{counts.present} in · {counts.absent} absent · {counts.departed} departed</Text>
        <Text style={[styles.roomFollowup, needsFollowup === 0 && styles.roomComplete]}>
          {needsFollowup ? `${needsFollowup} still expected or coming` : 'Everyone is accounted for'}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />}
    </TouchableOpacity>
  );
}

export default function AdminAttendanceScreen({ navigation }) {
  const { profile } = useAuth();
  const { classrooms, switchClassroom } = useClassroom();
  const ratioState = useRoomRatios();
  const [children, setChildren] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [openingRoomId, setOpeningRoomId] = useState(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!profile?.daycare_id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const childrenResult = await supabase.from('children')
      .select('id, first_name, last_name, classroom_id')
      .eq('daycare_id', profile.daycare_id)
      .is('archived_at', null)
      .order('first_name');
    if (childrenResult.error) {
      setError(childrenResult.error.message);
      setChildren([]);
      setRecords([]);
    } else {
      const childRows = childrenResult.data || [];
      setChildren(childRows);
      if (childRows.length) {
        const recordsResult = await supabase.from('attendance_records')
          .select('id, child_id, checked_in_at, checked_out_at, status, notes')
          .in('child_id', childRows.map(child => child.id))
          .eq('date', today);
        if (recordsResult.error) setError(recordsResult.error.message);
        setRecords(recordsResult.data || []);
      } else {
        setRecords([]);
      }
    }
    await ratioState.load({ quiet: true });
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id, ratioState.load, today]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const recordByChild = useMemo(() => Object.fromEntries(records.map(record => [record.child_id, record])), [records]);
  const roomCounts = useMemo(() => Object.fromEntries(classrooms.map(room => {
    const roomChildren = children.filter(child => child.classroom_id === room.id);
    const counts = { present: 0, absent: 0, coming: 0, awaited: 0, departed: 0, total: roomChildren.length };
    roomChildren.forEach(child => { counts[statusFor(recordByChild[child.id])] += 1; });
    return [room.id, counts];
  })), [children, classrooms, recordByChild]);

  const totals = useMemo(() => {
    const result = { present: 0, absent: 0, coming: 0, awaited: 0, departed: 0 };
    children.forEach(child => { result[statusFor(recordByChild[child.id])] += 1; });
    return result;
  }, [children, recordByChild]);

  const accounted = totals.present + totals.absent + totals.departed;

  async function openRoom(room) {
    setOpeningRoomId(room.id);
    await switchClassroom(room.id);
    setOpeningRoomId(null);
    navigation.navigate('RollCall');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Center attendance</Text>
          <Text style={styles.headerSub}>{format(new Date(), 'EEEE, MMMM d')}</Text>
        </View>
        <TouchableOpacity onPress={() => load({ refresh: true })} style={styles.headerButton} accessibilityLabel="Refresh center attendance">
          <Ionicons name="refresh-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><Ionicons name="checkmark-done-outline" size={23} color={colors.primary} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{accounted} of {children.length} accounted for</Text>
            <Text style={styles.heroText}>
              {totals.awaited + totals.coming
                ? `${totals.awaited + totals.coming} children still need an arrival or absence status.`
                : 'Every enrolled child has an attendance status for today.'}
            </Text>
          </View>
        </View>

        {error ? (
          <TouchableOpacity style={styles.errorCard} onPress={() => load()}>
            <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>Attendance could not refresh. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.summaryGrid}>
          <SummaryCard label="In now" value={totals.present} icon="enter-outline" tone="success" />
          <SummaryCard label="Absent" value={totals.absent} icon="calendar-outline" tone="amber" />
          <SummaryCard label="Awaited" value={totals.awaited + totals.coming} icon="time-outline" />
          <SummaryCard label="Departed" value={totals.departed} icon="exit-outline" tone="purple" />
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Rooms</Text>
          <Text style={styles.sectionMeta}>Tap a room to take roll</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : classrooms.map(room => (
          <RoomRow
            key={room.id}
            room={room}
            counts={roomCounts[room.id] || { present: 0, absent: 0, coming: 0, awaited: 0, departed: 0 }}
            ratio={ratioState.rooms.find(item => item.id === room.id)}
            ratioLoading={ratioState.loading}
            busy={openingRoomId === room.id}
            onPress={() => openRoom(room)}
          />
        ))}

        <View style={styles.noteCard}>
          <Ionicons name="sync-outline" size={18} color={colors.textFaint} />
          <Text style={styles.noteText}>Kiosk check-ins and family-reported absences update this center view automatically.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  headerSub: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  heroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  heroCopy: { flex: 1 },
  heroTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  heroText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  summaryCard: { width: '48.5%', minHeight: 106, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  summaryValue: { marginTop: spacing.sm, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22 },
  summaryLabel: { marginTop: 1, color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11.5 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  sectionMeta: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5 },
  roomCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  roomCardAlert: { borderColor: '#E9BFC0' },
  roomIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  roomIconAlert: { backgroundColor: colors.dangerLight },
  roomCopy: { flex: 1, minWidth: 0 },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roomName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  ratioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  ratioBadgeOk: { backgroundColor: colors.successLight },
  ratioBadgeAlert: { backgroundColor: colors.dangerLight },
  ratioBadgeNeutral: { backgroundColor: colors.primarySoft },
  ratioText: { fontFamily: fonts.bold, fontSize: 9.5 },
  ratioTextOk: { color: colors.success },
  ratioTextAlert: { color: colors.danger },
  ratioTextNeutral: { color: colors.textMuted },
  roomMeta: { marginTop: 4, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5 },
  roomFollowup: { marginTop: 3, color: colors.amber, fontFamily: fonts.bold, fontSize: 11.5 },
  roomComplete: { color: colors.success },
  loader: { paddingVertical: 70 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  noteText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
});
