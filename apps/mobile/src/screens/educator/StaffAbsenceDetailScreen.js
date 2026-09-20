import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { format, parseISO } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function formatRange(start, end) {
  if (!start) return 'Date unavailable';
  const startDate = parseISO(start);
  const endDate = parseISO(end || start);
  if (start === end || !end) return format(startDate, 'EEEE, MMMM d, yyyy');
  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${format(startDate, 'MMM d')} – ${format(endDate, 'MMM d, yyyy')}`;
  }
  return `${format(startDate, 'MMM d, yyyy')} – ${format(endDate, 'MMM d, yyyy')}`;
}

function reasonLabel(reason) {
  return (reason || 'Absence').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export default function StaffAbsenceDetailScreen({ navigation, route }) {
  const { reportId, startsOn, endsOn, childId } = route.params || {};
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!reportId) {
      setError('This absence report is missing its record reference.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase
      .from('parent_absence_reports')
      .select('id, child_id, starts_on, ends_on, reason, note, status, created_at, updated_at, cancelled_at, child:children(first_name, last_name, classroom:classrooms(name))')
      .eq('id', reportId)
      .maybeSingle();
    if (loadError || !data) {
      setError(loadError?.message || 'This absence report could not be found.');
    } else {
      setReport(data);
    }
    setLoading(false);
    setRefreshing(false);
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  const effectiveStart = report?.starts_on || startsOn;
  const effectiveEnd = report?.ends_on || endsOn || effectiveStart;
  const includesToday = useMemo(() => {
    if (!effectiveStart || !effectiveEnd) return false;
    const today = format(new Date(), 'yyyy-MM-dd');
    return today >= effectiveStart && today <= effectiveEnd;
  }, [effectiveEnd, effectiveStart]);
  const child = report?.child;
  const childName = child ? `${child.first_name} ${child.last_name}` : 'Child absence';
  const cancelled = report?.status === 'cancelled';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to notifications"
        >
          <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Absence report</Text>
          <Text style={styles.subtitle}>Reported by family</Text>
        </View>
      </View>

      {loading && !report ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ quiet: true }); }}
              tintColor={colors.primary}
            />
          )}
        >
          {error ? (
            <TouchableOpacity style={styles.errorCard} onPress={() => load()}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.danger} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Absence details unavailable</Text>
                <Text style={styles.errorText}>{error} Tap to retry.</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <>
              <View style={[styles.hero, cancelled && styles.heroCancelled]}>
                <View style={[styles.heroIcon, cancelled && styles.heroIconCancelled]}>
                  <Ionicons
                    name={cancelled ? 'calendar-clear-outline' : 'calendar-outline'}
                    size={28}
                    color={cancelled ? colors.textMuted : colors.amber}
                  />
                </View>
                <Text style={styles.heroEyebrow}>{cancelled ? 'CANCELLED' : 'FAMILY UPDATE'}</Text>
                <Text style={styles.childName}>{childName}</Text>
                {child?.classroom?.name ? <Text style={styles.classroom}>{child.classroom.name}</Text> : null}
                <View style={[styles.statusPill, cancelled && styles.statusPillCancelled]}>
                  <Text style={[styles.statusText, cancelled && styles.statusTextCancelled]}>
                    {cancelled ? 'Absence cancelled' : reasonLabel(report?.reason)}
                  </Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}><Ionicons name="calendar-outline" size={19} color={colors.primary} /></View>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailLabel}>WHEN</Text>
                    <Text style={styles.detailValue}>{formatRange(effectiveStart, effectiveEnd)}</Text>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}><Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.primary} /></View>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailLabel}>FAMILY NOTE</Text>
                    <Text style={styles.detailValue}>{report?.note?.trim() || 'No additional note was provided.'}</Text>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}><Ionicons name="time-outline" size={19} color={colors.primary} /></View>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailLabel}>{cancelled ? 'CANCELLED' : 'REPORTED'}</Text>
                    <Text style={styles.detailValue}>
                      {format(new Date(cancelled ? report.cancelled_at : report.created_at), 'MMM d, yyyy · h:mm a')}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.notice}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
                <Text style={styles.noticeText}>
                  The center office and assigned classroom staff received this family update.
                </Text>
              </View>

              {includesToday && !cancelled ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => navigation.navigate('RollCall', { childId: report?.child_id || childId })}
                  accessibilityRole="button"
                >
                  <Ionicons name="people-outline" size={20} color={colors.white} />
                  <Text style={styles.primaryButtonText}>Open today’s roll call</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => navigation.goBack()}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Back to notifications</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft, backgroundColor: colors.surface,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderSoft,
  },
  headerCopy: { flex: 1 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, paddingBottom: 42 },
  hero: {
    alignItems: 'center', borderWidth: 1, borderColor: `${colors.amber}55`,
    borderRadius: radius.xl, backgroundColor: colors.amberLight,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl,
  },
  heroCancelled: { borderColor: colors.borderSoft, backgroundColor: colors.surface },
  heroIcon: {
    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, marginBottom: spacing.md,
  },
  heroIconCancelled: { backgroundColor: colors.bg },
  heroEyebrow: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 1.1 },
  childName: { marginTop: 5, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 23 },
  classroom: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  statusPill: {
    marginTop: spacing.md, borderRadius: 999, paddingHorizontal: spacing.lg, paddingVertical: 7,
    backgroundColor: '#FFF3D8',
  },
  statusPillCancelled: { backgroundColor: colors.bg },
  statusText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 12.5 },
  statusTextCancelled: { color: colors.textMuted },
  card: {
    marginTop: spacing.lg, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden',
  },
  detailRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
  detailIcon: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  detailCopy: { flex: 1, minWidth: 0 },
  detailLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.8 },
  detailValue: { marginTop: 4, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, lineHeight: 20 },
  divider: { height: 1, marginLeft: 68, backgroundColor: colors.borderSoft },
  notice: {
    marginTop: spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderRadius: radius.lg, backgroundColor: colors.successLight, padding: spacing.lg,
  },
  noticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  primaryButton: {
    minHeight: 54, marginTop: spacing.xl, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  secondaryButton: {
    minHeight: 54, marginTop: spacing.xl, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    borderWidth: 1, borderColor: `${colors.danger}44`, borderRadius: radius.lg,
    backgroundColor: colors.dangerLight, padding: spacing.lg,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontFamily: fonts.bold, fontSize: 14 },
  errorText: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
