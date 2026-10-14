import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppState, Image, RefreshControl, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, subDays } from 'date-fns';

import { EmptyState, LoadingScreen } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useParentNotifications } from '../../hooks/useParentNotifications';
import { useRoomRatios } from '../../hooks/useRoomRatios';
import { exportAttendanceCsv } from '../../lib/export';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function greetingFor(date = new Date()) {
  if (date.getHours() < 12) return 'Good morning';
  if (date.getHours() < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(profile) {
  return (profile?.display_name || profile?.full_name || 'Admin').trim().split(/\s+/)[0];
}

function ProfileAvatar({ profile, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.avatar}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Open admin settings"
    >
      {profile?.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
      ) : (
        <Text style={styles.avatarText}>{firstName(profile)[0]?.toUpperCase() || 'A'}</Text>
      )}
    </TouchableOpacity>
  );
}

function MetricCard({ icon, label, value, detail, tone = 'primary', onPress }) {
  const body = (
    <>
      <View style={[styles.metricIcon, styles[`metricIcon_${tone}`]]}>
        <Ionicons name={icon} size={19} color={styles[`metricColor_${tone}`].color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={[styles.metricDetail, tone === 'danger' && styles.dangerText]} numberOfLines={2}>{detail}</Text>
    </>
  );
  return (
    <TouchableOpacity
      style={styles.metricCard}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${detail}`}
    >
      {body}
    </TouchableOpacity>
  );
}

function QuickAction({ icon, label, onPress }) {
  return (
    <TouchableOpacity
      style={styles.quickAction}
      onPress={onPress}
      activeOpacity={0.72}
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

function AttentionRow({ icon, tone, title, detail, action, onPress, last }) {
  return (
    <View>
      <TouchableOpacity style={styles.attentionRow} onPress={onPress} activeOpacity={0.72} accessibilityRole="button">
        <View style={[styles.attentionIcon, styles[`attentionIcon_${tone}`]]}>
          <Ionicons name={icon} size={18} color={styles[`attentionColor_${tone}`].color} />
        </View>
        <View style={styles.attentionCopy}>
          <Text style={styles.attentionTitle}>{title}</Text>
          <Text style={styles.attentionDetail}>{detail}</Text>
        </View>
        <View style={styles.attentionAction}>
          <Text style={styles.attentionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </View>
      </TouchableOpacity>
      {!last && <View style={styles.divider} />}
    </View>
  );
}

function RoomCard({ room, ratioLoading, onOpen, onExport }) {
  const hostedElsewhere = room.operating?.combination_id && room.operating?.host_room_id !== room.id;
  const isOver = Boolean(room.is_over_ratio);
  const unavailable = !room.ratioAvailable;
  const empty = !unavailable && !hostedElsewhere && !isOver && Number(room.present_count) === 0;
  const neutral = unavailable || hostedElsewhere || empty;
  let status;
  let badgeLabel;
  if (unavailable) {
    status = ratioLoading ? 'Checking ratio' : 'Ratio unavailable';
    badgeLabel = ratioLoading ? 'Checking' : 'Unavailable';
  } else if (hostedElsewhere) {
    status = `Combined in ${room.operating?.host_room_name || 'another room'}`;
    badgeLabel = 'Combined';
  } else if (isOver) {
    status = `Needs ${room.over_by || 1} more educator${Number(room.over_by || 1) === 1 ? '' : 's'}`;
    badgeLabel = 'Over ratio';
  } else if (empty) {
    status = 'No children checked in';
    badgeLabel = 'No children';
  } else {
    status = `In ratio · 1:${room.max_children_per_staff || '—'}`;
    badgeLabel = 'In ratio';
  }

  return (
    <View style={[styles.roomCard, isOver && styles.roomCardAlert]}>
      <TouchableOpacity
        style={styles.roomMain}
        onPress={onOpen}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`${room.name}. ${status}`}
      >
        <View style={[styles.roomIcon, isOver && styles.roomIconAlert]}>
          <Ionicons name={isOver ? 'warning-outline' : 'home-outline'} size={21} color={isOver ? colors.danger : colors.primary} />
        </View>
        <View style={styles.roomCopy}>
          <View style={styles.roomTitleRow}>
            <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
            <View style={[styles.ratioBadge, isOver ? styles.ratioBadgeAlert : neutral ? styles.ratioBadgeNeutral : styles.ratioBadgeOk]}>
              <Text style={[styles.ratioBadgeText, isOver ? styles.ratioBadgeTextAlert : neutral ? styles.ratioBadgeTextNeutral : styles.ratioBadgeTextOk]}>
                {badgeLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.roomMeta}>
            {unavailable ? 'Live counts unavailable' : hostedElsewhere ? status : `${room.present_count || 0} children · ${room.staff_count || 0} educator${Number(room.staff_count || 0) === 1 ? '' : 's'}`}
          </Text>
          <Text style={[styles.roomStatus, isOver && styles.dangerText, neutral && styles.neutralText]}>{status}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onExport}
        style={styles.roomExport}
        accessibilityRole="button"
        accessibilityLabel={`Export attendance for ${room.name}`}
      >
        <Ionicons name="download-outline" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

/** Mobile operating view of the admin web dashboard. */
export default function AdminDashboardScreen({ navigation }) {
  const isFocused = useIsFocused();
  const { profile } = useAuth();
  const notifications = useParentNotifications();
  const ratioState = useRoomRatios();
  const [stats, setStats] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [daycare, setDaycare] = useState(null);
  const [pendingIncidents, setPendingIncidents] = useState(0);
  const [pendingCredentials, setPendingCredentials] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latestStatsRequest = useRef(0);

  const rootNavigate = useCallback((name, params) => {
    navigation.getParent()?.navigate(name, params);
  }, [navigation]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile?.daycare_id) return;
    const statsRequest = ++latestStatsRequest.current;
    if (!quiet) setLoading(true);
    const [statsRes, roomsRes, daycareRes, incidentsRes, credentialsRes] = await Promise.all([
      supabase.rpc('get_daycare_stats'),
      supabase.from('classrooms').select('id, name, age_group, capacity')
        .eq('daycare_id', profile.daycare_id).is('archived_at', null).order('name'),
      supabase.from('daycares').select('id, name, address')
        .eq('id', profile.daycare_id).maybeSingle(),
      supabase.from('incident_reports').select('id', { count: 'exact', head: true })
        .eq('daycare_id', profile.daycare_id).eq('status', 'submitted'),
      supabase.from('staff_credential_submissions').select('id', { count: 'exact', head: true })
        .eq('daycare_id', profile.daycare_id).eq('status', 'pending'),
    ]);
    const rawStats = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
    if (statsRequest === latestStatsRequest.current) setStats(rawStats || null);
    setClassrooms(roomsRes.data || []);
    setDaycare(daycareRes.data || null);
    setPendingIncidents(incidentsRes.count || 0);
    setPendingCredentials(credentialsRes.count || 0);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useEffect(() => {
    if (isFocused && profile) load();
  }, [isFocused, load, profile]);

  const refreshStats = useCallback(async () => {
    const request = ++latestStatsRequest.current;
    const { data, error } = await supabase.rpc('get_daycare_stats');
    if (request !== latestStatsRequest.current || error) return;
    setStats(Array.isArray(data) ? data[0] || null : data || null);
  }, []);

  useEffect(() => {
    if (!isFocused || !profile?.daycare_id) return undefined;
    const refresh = () => { refreshStats(); };
    const channel = supabase.channel(`admin-dashboard-stats-${profile.daycare_id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records',
        filter: `daycare_id=eq.${profile.daycare_id}`,
      }, refresh)
      .subscribe();
    const poll = setInterval(refresh, 60_000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      latestStatsRequest.current += 1;
      clearInterval(poll);
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [isFocused, profile?.daycare_id, refreshStats]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      load({ quiet: true }),
      ratioState.load({ quiet: true }),
      notifications.refresh({ silent: true }).catch(() => {}),
    ]);
    setRefreshing(false);
  }, [load, notifications.refresh, ratioState.load]);

  async function handleExportAttendance(room) {
    const to = new Date();
    const from = subDays(to, 30);
    const fromStr = format(from, 'yyyy-MM-dd');
    const toStr = format(to, 'yyyy-MM-dd');
    const { data: rows, error } = await supabase.rpc('get_attendance_range', {
      p_classroom_id: room.id, p_start: fromStr, p_end: toStr,
    });
    if (error) { Alert.alert('Export failed', error.message); return; }
    if (!rows?.length) {
      Alert.alert('No attendance yet', `There are no attendance records for ${room.name} in the last 30 days.`);
      return;
    }
    try {
      await exportAttendanceCsv({ rows, classroomName: room.name, fromStr, toStr });
      showToast('Attendance exported', 'success');
    } catch (exportError) {
      Alert.alert('Export failed', exportError.message);
    }
  }

  const liveRooms = useMemo(() => classrooms.map((room) => {
    const live = ratioState.rooms.find((item) => item.id === room.id);
    return live ? { ...room, ...live, ratioAvailable: true } : { ...room, ratioAvailable: false };
  }), [classrooms, ratioState.rooms]);

  const overRatioRooms = liveRooms.filter(room => room.is_over_ratio);
  const occupiedRooms = liveRooms.filter(room => room.ratioAvailable && Number(room.present_count) > 0);
  const roomsInRatio = occupiedRooms.filter(room => !room.is_over_ratio).length;
  const ratiosReady = !ratioState.loading && !ratioState.error && liveRooms.every(room => room.ratioAvailable);
  const anyChildrenInRooms = occupiedRooms.length > 0;
  const enrolledChildren = Number(stats?.children ?? stats?.children_count ?? 0);
  const presentChildren = Number(stats?.present_today ?? 0);
  const staffCount = Number(stats?.staff ?? stats?.educator_count ?? 0);
  const unreadCount = notifications.unreadCount || 0;
  const attentionCount = overRatioRooms.length + pendingIncidents + pendingCredentials;
  const location = daycare?.address?.split(',')?.[0]?.trim() || daycare?.name || 'Your center';
  const reviewCoverage = overRatioRooms.length > 0 || !ratiosReady;
  const ratioDetail = !ratiosReady
    ? ratioState.loading ? 'Checking live ratios' : 'Live ratios unavailable'
    : overRatioRooms.length ? `${overRatioRooms.length} need coverage`
      : anyChildrenInRooms ? 'Occupied rooms only' : 'No children checked in yet';
  const overviewText = overRatioRooms.length
    ? `${overRatioRooms.map(room => room.name).join(', ')} ${overRatioRooms.length === 1 ? 'needs' : 'need'} staffing coverage now.`
    : !ratiosReady ? ratioState.loading ? 'Checking live room ratios.' : 'Live room ratios are unavailable. Open room ratios to retry.'
      : anyChildrenInRooms ? `${presentChildren} children are checked in and every occupied room is currently in ratio.`
        : 'No children are checked in yet. Room ratios will update as children arrive.';

  if (loading && !stats) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>{greetingFor()}, {firstName(profile)}</Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={styles.locationText} numberOfLines={1}>{format(new Date(), 'EEEE, MMMM d')} · {location}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => rootNavigate('StaffNotifications')}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
          >
            <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
            {unreadCount ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
          </TouchableOpacity>
          <ProfileAvatar profile={profile} onPress={() => navigation.navigate('AdminSettings')} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}><Ionicons name="pulse-outline" size={21} color={colors.primary} /></View>
            <Text style={styles.heroEyebrow}>LIVE CENTER OVERVIEW</Text>
          </View>
          <Text style={styles.heroTitle}>
            {attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need your attention` : 'Everything looks on track'}
          </Text>
          <Text style={styles.heroBody}>{overviewText}</Text>
          <TouchableOpacity
            style={styles.heroButton}
            onPress={() => rootNavigate(reviewCoverage ? 'RoomRatios' : 'AdminAttendance')}
            activeOpacity={0.78}
            accessibilityRole="button"
          >
            <Text style={styles.heroButtonText}>{reviewCoverage ? 'Review room coverage' : 'Open attendance'}</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard icon="people-outline" label="CHILDREN IN" value={`${presentChildren} / ${enrolledChildren}`}
            detail={presentChildren === enrolledChildren && enrolledChildren ? 'Everyone is here' : `${Math.max(enrolledChildren - presentChildren, 0)} not checked in`}
            onPress={() => rootNavigate('AdminAttendance')} />
          <MetricCard icon="shield-checkmark-outline" label="ROOMS IN RATIO" value={ratiosReady && anyChildrenInRooms ? `${roomsInRatio} / ${occupiedRooms.length}` : '—'}
            detail={ratioDetail}
            tone={overRatioRooms.length ? 'danger' : ratiosReady && anyChildrenInRooms ? 'success' : 'primary'} onPress={() => rootNavigate('RoomRatios')} />
          <MetricCard icon="school-outline" label="ACTIVE ROOMS"
            value={String(Number(stats?.classrooms ?? stats?.classroom_count ?? classrooms.length))}
            detail="View rosters & activity" onPress={() => navigation.navigate('ManageTab')} />
          <MetricCard icon="person-outline" label="TEAM" value={String(staffCount)} detail="Admins & educators"
            tone="purple" onPress={() => navigation.navigate('AdminUsers')} />
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActions}>
          <QuickAction icon="megaphone-outline" label="Announcement" onPress={() => rootNavigate('Announcements')} />
          <QuickAction icon="person-add-outline" label="Invite staff" onPress={() => navigation.navigate('AdminUsers', { openInvite: true })} />
          <QuickAction icon="alert-circle-outline" label="Incidents" onPress={() => rootNavigate('IncidentHub')} />
          <QuickAction icon="card-outline" label="Billing" onPress={() => rootNavigate('AdminBilling')} />
          <QuickAction icon="document-text-outline" label="Enrollment" onPress={() => rootNavigate('AdminEnrollmentReview')} />
          <QuickAction icon="shield-checkmark-outline" label="Compliance" onPress={() => rootNavigate('AdminCompliance')} />
          <QuickAction icon="calendar-outline" label="Time off" onPress={() => rootNavigate('AdminTimeOff')} />
          <QuickAction icon="shield-checkmark-outline" label="Credentials" onPress={() => rootNavigate('AdminCredentials')} />
        </ScrollView>

        {attentionCount > 0 && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Needs your attention</Text>
              <View style={styles.countBadge}><Text style={styles.countBadgeText}>{attentionCount}</Text></View>
            </View>
            <View style={styles.attentionCard}>
              {overRatioRooms.map((room, index) => (
                <AttentionRow key={room.id} icon="warning-outline" tone="danger" title={`${room.name} is over ratio`}
                  detail={`${room.present_count || 0} children · ${room.staff_count || 0} educators`} action="Fix"
                  onPress={() => rootNavigate('RoomRatios')} last={index === overRatioRooms.length - 1 && !pendingIncidents} />
              ))}
              {pendingIncidents > 0 && (
                <AttentionRow icon="document-text-outline" tone="warning"
                  title={`${pendingIncidents} incident report${pendingIncidents === 1 ? '' : 's'} awaiting sign-off`}
                  detail="Review the record before it is shared with the family." action="Review"
                  onPress={() => rootNavigate('IncidentHub')} last={!pendingCredentials} />
              )}
              {pendingCredentials > 0 && (
                <AttentionRow icon="shield-checkmark-outline" tone="warning"
                  title={`${pendingCredentials} credential renewal${pendingCredentials === 1 ? '' : 's'} awaiting review`}
                  detail="Verify the uploaded record before it replaces the current credential." action="Review"
                  onPress={() => rootNavigate('AdminCredentials')} last />
              )}
            </View>
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Rooms right now</Text>
          <TouchableOpacity onPress={() => rootNavigate('RoomRatios')} accessibilityRole="button"><Text style={styles.seeAll}>See all</Text></TouchableOpacity>
        </View>
        {liveRooms.length === 0 ? (
          <EmptyState icon="＋" message="Add a classroom to start tracking attendance and ratios." />
        ) : liveRooms.map(room => (
          <RoomCard key={room.id} room={room} ratioLoading={ratioState.loading} onOpen={() => rootNavigate('RoomRatios')}
            onExport={() => handleExportAttendance(room)} />
        ))}
        <View style={styles.exportNote}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.exportNoteText}>The download button on each room exports its last 30 days of attendance.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  headerCopy: { flex: 1, minWidth: 0 },
  greeting: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22, lineHeight: 27 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locationText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface },
  notificationBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.danger },
  notificationBadgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 9 },
  avatar: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 21, backgroundColor: colors.primaryLight },
  avatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 16 },
  heroCard: { padding: spacing.lg, marginBottom: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  heroEyebrow: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.1 },
  heroTitle: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, lineHeight: 25 },
  heroBody: { marginTop: spacing.xs, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  heroButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 46, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  heroButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  metricCard: { flexBasis: '47%', flexGrow: 1, minHeight: 132, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  metricIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, borderRadius: radius.md },
  metricIcon_primary: { backgroundColor: colors.primaryLight },
  metricIcon_success: { backgroundColor: colors.successLight },
  metricIcon_danger: { backgroundColor: colors.dangerLight },
  metricIcon_purple: { backgroundColor: colors.purpleLight },
  metricColor_primary: { color: colors.primary },
  metricColor_success: { color: colors.success },
  metricColor_danger: { color: colors.danger },
  metricColor_purple: { color: colors.purple },
  metricLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.8 },
  metricValue: { marginTop: 3, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22 },
  metricDetail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 15 },
  dangerText: { color: colors.danger },
  sectionBlock: { marginBottom: spacing.xl },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  seeAll: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  countBadge: { minWidth: 24, height: 24, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', marginRight: 'auto', borderRadius: 12, backgroundColor: colors.dangerLight },
  countBadgeText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11 },
  quickActions: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xl },
  quickAction: { width: 92, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  quickActionIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primaryLight },
  quickActionLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 11.5, textAlign: 'center' },
  attentionCard: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  attentionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  attentionIcon_danger: { backgroundColor: colors.dangerLight },
  attentionIcon_warning: { backgroundColor: colors.amberLight },
  attentionColor_danger: { color: colors.danger },
  attentionColor_warning: { color: colors.amber },
  attentionCopy: { flex: 1, minWidth: 0 },
  attentionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  attentionDetail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  attentionAction: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  attentionActionText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  divider: { height: 1, marginLeft: 62, backgroundColor: colors.borderSoft },
  roomCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  roomMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  roomCardAlert: { borderColor: '#EFCACA', backgroundColor: '#FFFBFB' },
  roomIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  roomIconAlert: { backgroundColor: colors.dangerLight },
  roomCopy: { flex: 1, minWidth: 0 },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roomName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  roomMeta: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
  roomStatus: { marginTop: 3, color: colors.success, fontFamily: fonts.bold, fontSize: 11 },
  ratioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  ratioBadgeOk: { backgroundColor: colors.successLight },
  ratioBadgeAlert: { backgroundColor: colors.dangerLight },
  ratioBadgeNeutral: { backgroundColor: colors.primarySoft },
  ratioBadgeText: { fontFamily: fonts.bold, fontSize: 9.5 },
  ratioBadgeTextOk: { color: colors.success },
  ratioBadgeTextAlert: { color: colors.danger },
  ratioBadgeTextNeutral: { color: colors.textMuted },
  neutralText: { color: colors.textMuted },
  roomExport: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm, borderRadius: 19, backgroundColor: colors.primarySoft },
  exportNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  exportNoteText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
});
