import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { ChildAvatar } from '../../components/ChildAvatar';
import { Button, EmptyState, LoadingScreen } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { useClassroom } from '../../hooks/useClassroom';
import { isDailyLogReady } from '../../lib/dailyLogs';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function reportSummary(log) {
  const details = [];
  if (log?.mealCount) details.push(`${log.mealCount} meal${log.mealCount === 1 ? '' : 's'}`);
  if (log?.sleepCount) details.push(`${log.sleepCount} nap${log.sleepCount === 1 ? '' : 's'}`);
  if (log?.diaperCount) details.push(`${log.diaperCount} care check${log.diaperCount === 1 ? '' : 's'}`);
  if (log?.activityCount) details.push(`${log.activityCount} activit${log.activityCount === 1 ? 'y' : 'ies'}`);
  if (log?.notes?.trim() || log?.comments?.trim()) details.push('note added');
  return details.length ? details.join(' · ') : 'No daily details yet';
}

function ReportRow({ item, busy, onOpen, onSend }) {
  const sent = Boolean(item.log?.sent_to_parents);
  const ready = isDailyLogReady(item.log);
  const attended = Boolean(item.attendance?.checked_in_at || item.log);
  const status = sent ? 'Sent' : ready ? 'Ready' : attended ? 'Needs a note' : 'Not in today';
  const toneStyle = sent
    ? styles.statusSent
    : ready
      ? styles.statusReady
      : attended ? styles.statusNeedsNote : styles.statusAway;
  const toneText = sent
    ? styles.statusTextSent
    : ready
      ? styles.statusTextReady
      : attended ? styles.statusTextNeedsNote : styles.statusTextAway;

  return (
    <View style={styles.reportRow}>
      <TouchableOpacity
        onPress={() => onOpen(item.child)}
        style={styles.reportMain}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.child.first_name}'s daily report. ${status}`}
      >
        <ChildAvatar child={item.child} size={42} fontSize={13} />
        <View style={styles.reportCopy}>
          <Text style={styles.childName}>{item.child.first_name} {item.child.last_name}</Text>
          <Text style={styles.reportDetails} numberOfLines={2}>{reportSummary(item.log)}</Text>
          {sent && item.log?.sent_at ? (
            <Text style={styles.sentTime}>Sent {format(new Date(item.log.sent_at), 'h:mm a')}</Text>
          ) : null}
        </View>
        <View style={[styles.status, toneStyle]}>
          <Text style={[styles.statusText, toneText]}>{status}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </TouchableOpacity>
      {ready ? (
        <TouchableOpacity
          onPress={() => onSend(item)}
          disabled={busy}
          style={[styles.sendRowButton, busy && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={`Send ${item.child.first_name}'s report to family`}
        >
          <Ionicons name="send-outline" size={16} color={colors.primary} />
          <Text style={styles.sendRowText}>{busy ? 'Sending…' : 'Send to family'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function DailyReportReviewScreen({ navigation, route }) {
  const { active: activeClassroom } = useClassroom();
  const isFocused = useIsFocused();
  const reportDate = route.params?.date || format(new Date(), 'yyyy-MM-dd');
  const roomIds = activeClassroom?.member_room_ids?.length
    ? activeClassroom.member_room_ids
    : activeClassroom?.id ? [activeClassroom.id] : [];
  const roomKey = roomIds.join(',');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingIds, setSendingIds] = useState(new Set());
  const [sendingAll, setSendingAll] = useState(false);

  const load = useCallback(async () => {
    if (!roomIds.length) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data: children, error: childError } = await supabase
      .from('children')
      .select('*')
      .in('classroom_id', roomIds)
      .is('archived_at', null)
      .order('first_name');
    if (childError) {
      showToast("We couldn't load this classroom's reports.", 'error');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const childIds = (children || []).map(child => child.id);
    if (!childIds.length) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const [{ data: logs, error: logError }, { data: attendance, error: attendanceError }] = await Promise.all([
      supabase
        .from('daily_logs')
        .select('id, child_id, notes, comments, sent_to_parents, sent_at')
        .in('child_id', childIds)
        .eq('log_date', reportDate),
      supabase
        .from('attendance_records')
        .select('child_id, checked_in_at, checked_out_at, status')
        .in('child_id', childIds)
        .eq('date', reportDate),
    ]);
    if (logError) {
      showToast("We couldn't load today's daily reports.", 'error');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (attendanceError) {
      showToast("We couldn't confirm today's attendance.", 'error');
    }

    const logIds = (logs || []).map(log => log.id);
    const entryResults = logIds.length
      ? await Promise.all([
        supabase.from('meal_entries').select('daily_log_id').in('daily_log_id', logIds),
        supabase.from('sleep_entries').select('daily_log_id').in('daily_log_id', logIds),
        supabase.from('diaper_entries').select('daily_log_id').in('daily_log_id', logIds),
        supabase.from('activity_entries').select('daily_log_id').in('daily_log_id', logIds),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

    const counts = new Map();
    const add = (logId, key) => {
      const current = counts.get(logId) || { mealCount: 0, sleepCount: 0, diaperCount: 0, activityCount: 0 };
      current[key] += 1;
      counts.set(logId, current);
    };
    (entryResults[0].data || []).forEach(row => add(row.daily_log_id, 'mealCount'));
    (entryResults[1].data || []).forEach(row => add(row.daily_log_id, 'sleepCount'));
    (entryResults[2].data || []).forEach(row => add(row.daily_log_id, 'diaperCount'));
    (entryResults[3].data || []).forEach(row => add(row.daily_log_id, 'activityCount'));

    const logsByChild = new Map((logs || []).map(log => [
      log.child_id,
      { ...log, ...(counts.get(log.id) || {}) },
    ]));
    const attendanceByChild = new Map((attendance || []).map(record => [record.child_id, record]));
    setItems((children || []).map(child => ({
      child,
      log: logsByChild.get(child.id) || null,
      attendance: attendanceByChild.get(child.id) || null,
    })));
    setLoading(false);
    setRefreshing(false);
  }, [reportDate, roomKey]);

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused, load]);

  const readyItems = useMemo(() => items.filter(item => isDailyLogReady(item.log)), [items]);
  const sentCount = useMemo(() => items.filter(item => item.log?.sent_to_parents).length, [items]);
  const needsNoteCount = useMemo(() => items.filter(item => (
    !item.log?.sent_to_parents
    && !isDailyLogReady(item.log)
    && Boolean(item.attendance?.checked_in_at || item.log)
  )).length, [items]);

  async function publish(item) {
    if (!item.log?.id || !isDailyLogReady(item.log)) return false;
    setSendingIds(current => new Set(current).add(item.log.id));
    const { error } = await supabase.rpc('publish_daily_log', { p_daily_log_id: item.log.id });
    setSendingIds(current => {
      const next = new Set(current);
      next.delete(item.log.id);
      return next;
    });
    if (error) {
      Alert.alert('Could not send report', error.message);
      return false;
    }
    await load();
    showToast(`${item.child.first_name}'s report was sent.`, 'success');
    return true;
  }

  function confirmPublish(item) {
    Alert.alert(
      `Send ${item.child.first_name}'s report?`,
      'The family will receive the final daily recap. The report becomes read-only after it is sent.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send report', onPress: () => publish(item) },
      ],
    );
  }

  function confirmPublishAll() {
    if (!readyItems.length) return;
    Alert.alert(
      `Send ${readyItems.length} ready report${readyItems.length === 1 ? '' : 's'}?`,
      'Each family will receive its child’s final daily recap. Reports that still need a note will stay in draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send ready reports',
          onPress: async () => {
            setSendingAll(true);
            let sent = 0;
            for (const item of readyItems) {
              const { error } = await supabase.rpc('publish_daily_log', { p_daily_log_id: item.log.id });
              if (error) break;
              sent += 1;
            }
            setSendingAll(false);
            await load();
            if (sent === readyItems.length) {
              showToast(`${sent} report${sent === 1 ? '' : 's'} sent to families.`, 'success');
            } else {
              Alert.alert('Some reports were not sent', `${sent} of ${readyItems.length} reports were sent. Review the remaining drafts and try again.`);
            }
          },
        },
      ],
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton} accessibilityLabel="Back to kids">
            <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>END-OF-DAY HANDOFF</Text>
            <Text style={styles.title}>Review daily reports</Text>
            <Text style={styles.subtitle}>{activeClassroom?.name || 'Classroom'} · {format(new Date(`${reportDate}T12:00:00`), 'MMMM d')}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryItem}><Text style={styles.summaryValue}>{readyItems.length}</Text><Text style={styles.summaryLabel}>Ready</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}><Text style={[styles.summaryValue, { color: colors.amber }]}>{needsNoteCount}</Text><Text style={styles.summaryLabel}>Need a note</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}><Text style={[styles.summaryValue, { color: colors.success }]}>{sentCount}</Text><Text style={styles.summaryLabel}>Sent</Text></View>
        </View>

        {readyItems.length ? (
          <Button
            label={`Send ${readyItems.length} ready report${readyItems.length === 1 ? '' : 's'}`}
            onPress={confirmPublishAll}
            loading={sendingAll}
            style={styles.sendAll}
          />
        ) : null}

        <Text style={styles.sectionTitle}>Children</Text>
        {!items.length ? <EmptyState icon="📋" message="There are no children in this classroom." /> : (
          <View style={styles.list}>
            {items.map((item, index) => (
              <View key={item.child.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <ReportRow
                  item={item}
                  busy={sendingIds.has(item.log?.id)}
                  onOpen={child => navigation.navigate('DailyLog', { child, date: reportDate })}
                  onSend={confirmPublish}
                />
              </View>
            ))}
          </View>
        )}
        <Text style={styles.footerNote}>Families see live classroom updates during the day. Sending creates the final recap and notifies linked family members.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.lg },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headerCopy: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  eyebrow: { color: colors.textFaint, fontFamily: fonts.black, fontSize: 10, letterSpacing: 1 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 23, marginTop: 3 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 3 },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border, paddingVertical: spacing.lg, marginBottom: spacing.md },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { color: colors.primary, fontFamily: fonts.black, fontSize: 24 },
  summaryLabel: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11, marginTop: 2 },
  summaryDivider: { width: 1, height: 34, backgroundColor: colors.borderSoft },
  sendAll: { marginBottom: spacing.xl },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16, marginBottom: spacing.sm },
  list: { overflow: 'hidden', backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border },
  reportRow: { backgroundColor: colors.surface },
  reportMain: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  reportCopy: { flex: 1, minWidth: 0 },
  childName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  reportDetails: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  sentTime: { color: colors.success, fontFamily: fonts.bold, fontSize: 10.5, marginTop: 3 },
  status: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  statusReady: { backgroundColor: colors.primaryLight },
  statusNeedsNote: { backgroundColor: colors.amberLight },
  statusSent: { backgroundColor: colors.successLight },
  statusAway: { backgroundColor: '#EEF2F7' },
  statusText: { fontFamily: fonts.bold, fontSize: 10.5 },
  statusTextReady: { color: colors.primary },
  statusTextNeedsNote: { color: colors.amber },
  statusTextSent: { color: colors.success },
  statusTextAway: { color: colors.textFaint },
  sendRowButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 42, marginHorizontal: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  sendRowText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  disabled: { opacity: 0.55 },
  divider: { height: 1, backgroundColor: colors.borderSoft },
  footerNote: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.md },
});
