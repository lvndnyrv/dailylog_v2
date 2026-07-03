import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, Alert
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { exportAttendanceCsv } from '../../lib/export';
import { LoadingScreen, EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';
import { format, subDays } from 'date-fns';

/**
 * Admin dashboard — daycare-wide stats, classroom list, attendance export.
 */
export default function AdminDashboardScreen() {
  const navigation = useNavigation();
  const isFocused  = useIsFocused();
  const { profile } = useAuth();
  const [stats, setStats]           = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [daycare, setDaycare]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (isFocused && profile) load();
  }, [isFocused, profile]);

  async function load() {
    const [statsRes, roomsRes, daycareRes] = await Promise.all([
      supabase.rpc('get_daycare_stats'),
      supabase
        .from('classrooms')
        .select('*, children(count)')
        .eq('daycare_id', profile.daycare_id)
        .order('name'),
      supabase
        .from('daycares')
        .select('*')
        .eq('id', profile.daycare_id)
        .maybeSingle(),
    ]);
    setStats(statsRes.data?.[0] || null);
    setClassrooms(roomsRes.data || []);
    setDaycare(daycareRes.data || null);
    setLoading(false);
    setRefreshing(false);
  }

  async function handleExportAttendance(room) {
    const to = new Date();
    const from = subDays(to, 30);
    const fromStr = format(from, 'yyyy-MM-dd');
    const toStr = format(to, 'yyyy-MM-dd');

    const { data: rows, error } = await supabase.rpc('get_attendance_range', {
      p_classroom_id: room.id,
      p_from: fromStr,
      p_to: toStr,
    });
    if (error) { Alert.alert('Export failed', error.message); return; }
    if (!rows?.length) { Alert.alert('No data', 'No attendance records in the last 30 days for this room.'); return; }

    try {
      await exportAttendanceCsv({ rows, classroomName: room.name, fromStr, toStr });
      showToast('📊 Attendance exported', 'success');
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  if (loading) return <LoadingScreen />;

  const statCards = [
    { label: 'Classrooms', value: stats?.classroom_count ?? '—', icon: '🏫' },
    { label: 'Children',   value: stats?.children_count ?? '—', icon: '👶' },
    { label: 'Staff',      value: stats?.educator_count ?? '—', icon: '🧑‍🏫' },
    { label: 'Present now', value: stats?.present_today ?? '—', icon: '📍' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      <Text style={styles.pageTitle}>{daycare?.name || 'Dashboard'}</Text>
      <Text style={styles.pageSub}>Admin overview · {format(new Date(), 'EEEE, MMM d')}</Text>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        {statCards.map(s => (
          <View key={s.label} style={styles.statCard}>
            <Text style={styles.statIcon}>{s.icon}</Text>
            <Text style={styles.statValue}>{String(s.value)}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Announcements shortcut */}
      <TouchableOpacity
        style={styles.annBtn}
        onPress={() => navigation.navigate('Announcements')}
        activeOpacity={0.7}
      >
        <Text style={styles.annBtnIcon}>📢</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.annBtnTitle}>Announcements</Text>
          <Text style={styles.annBtnSub}>Broadcast to all parents or a single room</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Classrooms */}
      <Text style={styles.sectionTitle}>Classrooms</Text>
      {classrooms.length === 0 ? (
        <EmptyState icon="🏫" message="No classrooms yet." />
      ) : (
        classrooms.map(room => (
          <View key={room.id} style={styles.roomCard}>
            <View style={styles.roomIcon}><Text style={{ fontSize: 18 }}>🏫</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.roomName}>{room.name}</Text>
              <Text style={styles.roomMeta}>
                {room.age_group ? `${room.age_group} · ` : ''}
                {room.children?.[0]?.count ?? 0} children
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleExportAttendance(room)}
              style={styles.exportBtn}
              accessibilityLabel={`Export attendance for ${room.name}`}
            >
              <Text style={styles.exportBtnText}>⬇ CSV</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.exportHint}>
        CSV exports cover the last 30 days of attendance for licensing audits.
      </Text>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  pageSub: { fontSize: 13, color: colors.textSecondary, marginTop: 3, marginBottom: spacing.xl },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flexBasis: '47%', flexGrow: 1,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center',
  },
  statIcon: { fontSize: 22, marginBottom: spacing.xs },
  statValue: { fontSize: 24, fontWeight: '700', color: colors.primary },
  statLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', marginTop: 2 },
  annBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.xl,
  },
  annBtnIcon: { fontSize: 24 },
  annBtnTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  annBtnSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  roomCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  roomIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  roomName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  roomMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  exportBtn: {
    backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  exportBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  exportHint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 17 },
});

