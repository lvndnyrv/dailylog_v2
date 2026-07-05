import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { useDailyLog } from '../../hooks/useDailyLog';
import { LoadingScreen, Badge, EmptyState, Divider } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import ConsentScreen from '../shared/ConsentScreen';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday } from 'date-fns';

const MOOD_EMOJI = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };
const AMOUNT_STYLE = {
  all: { color: colors.success, bg: colors.successLight },
  some: { color: colors.amber, bg: colors.amberLight },
  none: { color: colors.danger, bg: colors.dangerLight },
};

// ─── EMPTY STATE with child invite code entry ────────────────────────────────
function LinkChildEmptyState({ onLinked }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [linking, setLinking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function handleLink() {
    if (!code.trim()) { setError('Enter the code from your daycare.'); return; }
    setLinking(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('link_child_with_code', { p_code: code.trim() });
    setLinking(false);
    if (rpcError) { setError(rpcError.message); return; }
    const linked = data?.[0];
    if (linked) onLinked();
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onLinked();
    setRefreshing(false);
  }

  return (
    <ScrollView style={emptyStyles.container} contentContainerStyle={emptyStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={emptyStyles.icon}>👶</Text>
      <Text style={emptyStyles.title}>Link your child</Text>
      <Text style={emptyStyles.body}>
        Your daycare educator can give you a 6-character child code, or they can
        link you directly by email — in that case just refresh below.
      </Text>

      <View style={emptyStyles.card}>
        <Text style={emptyStyles.cardLabel}>Child code</Text>
        <TextInput
          style={[emptyStyles.input, error && emptyStyles.inputError]}
          value={code}
          onChangeText={(v) => { setCode(v.toUpperCase()); setError(null); }}
          placeholder="e.g. K7PM3Q"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
        />
        {error && <Text style={emptyStyles.errorText}>{error}</Text>}
        <TouchableOpacity
          style={[emptyStyles.linkBtn, linking && { opacity: 0.6 }]}
          onPress={handleLink}
          disabled={linking}
        >
          <Text style={emptyStyles.linkBtnText}>{linking ? 'Linking...' : 'Link my child'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={handleRefresh} style={emptyStyles.refreshBtn} disabled={refreshing}>
        <Text style={emptyStyles.refreshText}>
          {refreshing ? 'Checking...' : '↻ My daycare already added me — refresh'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const emptyStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: 80, alignItems: 'center' },
  icon: { fontSize: 56, marginBottom: spacing.lg },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  body: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 21, marginBottom: spacing.xl,
  },
  card: {
    alignSelf: 'stretch', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  cardLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 18, letterSpacing: 4, textAlign: 'center',
    color: colors.textPrimary, backgroundColor: colors.bg, fontWeight: '700',
  },
  inputError: { borderColor: colors.danger },
  errorText: { fontSize: 12, color: colors.danger, fontWeight: '500', marginTop: spacing.xs },
  linkBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md + 2, alignItems: 'center', marginTop: spacing.md,
  },
  linkBtnText: { fontSize: 15, fontWeight: '600', color: colors.white },
  refreshBtn: { marginTop: spacing.xl, padding: spacing.md },
  refreshText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
});

export default function ParentHomeScreen({ navigation }) {
  const { profile } = useAuth();
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [pendingIncidents, setPendingIncidents] = useState([]);
  const [pendingConsentChild, setPendingConsentChild] = useState(null); // COPPA/PIPEDA consent gate
  const [attendanceRec, setAttendanceRec] = useState(null);
  const [announcements, setAnnouncements] = useState([]);

  const {
    log, meals, diapers, sleeps, activities, supplies, loading,
  } = useDailyLog(selectedChild?.id, selectedDate); // read-only: parents never create logs

  async function fetchChildren() {
    const { data } = await supabase
      .from('parent_children')
      .select('consent_given_at, child:children(*)')
      .eq('parent_id', profile.id);

    const links = data || [];
    const kids = links.map(r => r.child).filter(Boolean);
    setChildren(kids);
    if (kids.length > 0) setSelectedChild(prev => prev && kids.find(k => k.id === prev.id) ? prev : kids[0]);

    // First child lacking consent → show the consent flow before anything else
    const needsConsent = links.find(r => r.child && !r.consent_given_at)?.child || null;
    setPendingConsentChild(needsConsent);

    setLoadingChildren(false);
  }

  useEffect(() => {
    if (profile) fetchChildren();
  }, [profile]);

  // Fetch unacknowledged incidents for the selected child
  useEffect(() => {
    async function fetchIncidents() {
      if (!selectedChild?.id) return;
      const { data } = await supabase
        .from('incident_reports')
        .select('*')
        .eq('child_id', selectedChild.id)
        .eq('status', 'submitted')
        .order('occurred_at', { ascending: false });
      setPendingIncidents(data || []);
    }
    fetchIncidents();

    // Real-time for incidents
    if (!selectedChild?.id) return;
    const channel = supabase
      .channel(`parent-incidents:${selectedChild.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_reports',
        filter: `child_id=eq.${selectedChild.id}`,
      }, () => fetchIncidents())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [selectedChild?.id]);

  // Attendance record for the selected child + date
  useEffect(() => {
    async function fetchAttendance() {
      if (!selectedChild?.id) { setAttendanceRec(null); return; }
      const { data } = await supabase
        .from('attendance_records')
        .select('checked_in_at, checked_out_at')
        .eq('child_id', selectedChild.id)
        .eq('date', format(selectedDate, 'yyyy-MM-dd'))
        .maybeSingle();
      setAttendanceRec(data || null);
    }
    fetchAttendance();
  }, [selectedChild?.id, selectedDate]);

  // Recent announcements (last 5, newest first — pinned first)
  useEffect(() => {
    async function fetchAnnouncements() {
      const { data } = await supabase
        .from('announcements')
        .select('id, title, body, pinned, created_at, classroom_id')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5);
      setAnnouncements(data || []);
    }
    if (profile) fetchAnnouncements();
  }, [profile]);

  if (loadingChildren || loading) return <LoadingScreen />;

  if (!children.length) {
    return (
      <LinkChildEmptyState onLinked={fetchChildren} />
    );
  }

  // COPPA/PIPEDA: require consent per child before showing their data
  if (pendingConsentChild) {
    return (
      <ConsentScreen
        childId={pendingConsentChild.id}
        childName={pendingConsentChild.first_name}
        onDone={fetchChildren}
      />
    );
  }

  const today = isToday(selectedDate);
  const hasMoods = log?.moods?.length > 0;
  const hasContent = meals.length || diapers.length || sleeps.length || activities.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} tintColor={colors.primary} />}>

      {/* Child tabs */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childTabs} contentContainerStyle={{ gap: spacing.sm }}>
          {children.map(child => (
            <TouchableOpacity
              key={child.id}
              onPress={() => setSelectedChild(child)}
              style={[styles.childTab, selectedChild?.id === child.id && styles.childTabSelected]}
            >
              <Text style={[styles.childTabText, selectedChild?.id === child.id && { color: colors.primary }]}>
                {child.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Incident alert banner */}
      {pendingIncidents.length > 0 && (
        <View style={styles.incidentBanner}>
          {pendingIncidents.map(incident => (
            <TouchableOpacity
              key={incident.id}
              style={[
                styles.incidentAlert,
                { borderColor: incident.severity === 'serious' ? colors.danger : colors.amber },
              ]}
              onPress={() => navigation.navigate('IncidentDetail', { incident, child: selectedChild })}
              activeOpacity={0.7}
            >
              <Text style={styles.incidentAlertEmoji}>
                {incident.severity === 'serious' ? '🚨' : incident.severity === 'moderate' ? '⚠️' : '🟡'}
              </Text>
              <View style={styles.incidentAlertContent}>
                <Text style={styles.incidentAlertTitle}>
                  {incident.severity === 'serious' ? 'Serious' : incident.severity === 'moderate' ? 'Moderate' : 'Minor'} incident reported
                </Text>
                <Text style={styles.incidentAlertSub}>
                  {incident.injury_type} · {format(new Date(incident.occurred_at), 'h:mm a')} — Tap to review
                </Text>
              </View>
              <Text style={styles.incidentAlertChevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => setSelectedDate(d => subDays(d, 1))} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dateCentre}>
          <Text style={styles.dateLabel}>
            {today ? 'Today' : format(selectedDate, 'EEEE')}
          </Text>
          <Text style={styles.dateSubLabel}>{format(selectedDate, 'MMMM d, yyyy')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setSelectedDate(d => addDays(d, 1))}
          style={[styles.dateBtn, today && styles.dateBtnDisabled]}
          disabled={today}
        >
          <Text style={[styles.dateBtnText, today && { color: colors.border }]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Announcements */}
      {announcements.length > 0 && (
        <TouchableOpacity
          style={styles.annCard}
          onPress={() => navigation.navigate('Announcements')}
          activeOpacity={0.8}
        >
          <Text style={styles.annTitle}>📢 Announcements</Text>
          {announcements.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider />}
              <View style={styles.annRow}>
                {a.pinned && <Text style={styles.annPin}>📌</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.annRowTitle}>{a.title}</Text>
                  <Text style={styles.annRowBody} numberOfLines={3}>{a.body}</Text>
                  <Text style={styles.annRowDate}>{format(new Date(a.created_at), 'MMM d, h:mm a')}</Text>
                </View>
              </View>
            </View>
          ))}
        </TouchableOpacity>
      )}

      {/* Header card */}
      <View style={styles.heroCard}>
        <View>
          <Text style={styles.heroName}>{selectedChild?.first_name}'s day</Text>
          {log?.sent_to_parents
            ? <Badge label="Log sent ✓" color={colors.success} bg={colors.successLight} />
            : today
              ? <Badge label="In progress..." color={colors.amber} bg={colors.amberLight} />
              : <Badge label="Not filled" color={colors.textMuted} bg={colors.bg} />
          }
          {/* Attendance times */}
          {attendanceRec?.checked_in_at && (
            <Text style={styles.attendanceText}>
              📍 Arrived {format(new Date(attendanceRec.checked_in_at), 'h:mm a')}
              {attendanceRec.checked_out_at && ` · Left ${format(new Date(attendanceRec.checked_out_at), 'h:mm a')}`}
            </Text>
          )}
        </View>
        {hasMoods && (
          <Text style={styles.moodDisplay}>
            {log.moods.map(m => MOOD_EMOJI[m] || '').join(' ')}
          </Text>
        )}
      </View>

      {/* Quick actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('WeeklySummary', {
            childId: selectedChild?.id,
            childName: selectedChild?.first_name,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>📊</Text>
          <Text style={styles.actionText}>Weekly summary</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Messaging', {
            childId: selectedChild?.id,
            childName: selectedChild?.first_name,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionText}>Message educator</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Medication', {
            child: selectedChild,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.actionIcon}>💊</Text>
          <Text style={styles.actionText}>Medications</Text>
        </TouchableOpacity>
      </View>

      {!hasContent && !hasMoods ? (
        <EmptyState icon="📋" message={today ? "No entries yet today.\nCheck back later!" : "No log was filled for this day."} />
      ) : (
        <>
          {/* Mood */}
          {hasMoods && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>😊  Today's mood</Text>
              <View style={styles.moodRow}>
                {log.moods.map(m => (
                  <View key={m} style={styles.moodChip}>
                    <Text style={styles.moodEmoji}>{MOOD_EMOJI[m]}</Text>
                    <Text style={styles.moodLabel}>{m}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Meals */}
          {meals.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🍽  Meals</Text>
              {meals.map((meal, i) => (
                <View key={meal.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.mealRow}>
                    <Text style={styles.mealTime}>{meal.time?.substring(0, 5)}</Text>
                    <Text style={styles.mealFood}>{meal.food_type}</Text>
                    <Badge
                      label={meal.amount}
                      color={AMOUNT_STYLE[meal.amount]?.color}
                      bg={AMOUNT_STYLE[meal.amount]?.bg}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Sleep */}
          {sleeps.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>😴  Sleep</Text>
              {sleeps.map(s => {
                const duration = s.end_time
                  ? calcDuration(s.start_time, s.end_time)
                  : 'still napping';
                return (
                  <View key={s.id} style={styles.sleepRow}>
                    <Text style={styles.sleepTime}>{s.start_time?.substring(0, 5)} – {s.end_time?.substring(0, 5) || '...'}</Text>
                    <Text style={styles.sleepDuration}>{duration}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Diapers */}
          {diapers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🩲  Diaper / toilet</Text>
              {diapers.map((d, i) => (
                <View key={d.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.diaperRow}>
                    <Text style={styles.mealTime}>{d.time?.substring(0, 5)}</Text>
                    <Badge label={d.type} color={colors.textSecondary} bg={colors.bg} />
                    {d.wet && <Badge label="Wet" color={colors.purple} bg={colors.purpleLight} />}
                    {d.bm && <Badge label="BM" color={colors.amber} bg={colors.amberLight} />}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Activities */}
          {activities.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎨  Activities</Text>
              <View style={styles.activityWrap}>
                {activities.map(a => (
                  <View key={a.id} style={styles.activityChip}>
                    <Text style={styles.activityText}>{a.activity_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Supplies */}
          {supplies.length > 0 && (
            <View style={[styles.card, styles.supplyCard]}>
              <Text style={[styles.cardTitle, { color: colors.danger }]}>📦  Please bring more</Text>
              <View style={styles.activityWrap}>
                {supplies.map(s => (
                  <View key={s.id} style={styles.supplyChip}>
                    <Text style={styles.supplyText}>{s.item_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Notes */}
          {(log?.notes || log?.comments) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📝  Notes from the educator</Text>
              {log.notes ? <Text style={styles.noteText}>{log.notes}</Text> : null}
              {log.comments ? <Text style={styles.noteText}>{log.comments}</Text> : null}
            </View>
          )}

          {/* Photos */}
          {log && <PhotoSection logId={log.id} childId={selectedChild?.id} readOnly={true} />}
        </>
      )}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

function calcDuration(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  childTabs: { marginBottom: spacing.md },
  childTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  childTabSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  childTabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateBtn: { padding: spacing.lg },
  dateBtnDisabled: { opacity: 0.3 },
  dateBtnText: { fontSize: 22, color: colors.primary, fontWeight: '500' },
  dateCentre: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  dateSubLabel: { fontSize: 12, color: colors.textSecondary },
  heroCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '33',
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', gap: spacing.xs,
  },
  actionIcon: { fontSize: 22 },
  actionText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', textAlign: 'center' },
  heroName: { fontSize: 20, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.xs },
  moodDisplay: { fontSize: 32 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  supplyCard: { borderColor: colors.danger + '44' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moodEmoji: { fontSize: 16 },
  moodLabel: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  mealTime: { fontSize: 13, color: colors.textSecondary, width: 46, fontWeight: '500' },
  mealFood: { flex: 1, fontSize: 14, color: colors.textPrimary },
  sleepRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  sleepTime: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  sleepDuration: { fontSize: 13, color: colors.textSecondary },
  diaperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  activityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activityChip: {
    backgroundColor: colors.purpleLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.full,
  },
  activityText: { fontSize: 13, color: colors.purple, fontWeight: '500' },
  supplyChip: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.full,
  },
  supplyText: { fontSize: 13, color: colors.danger, fontWeight: '500' },
  noteText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, marginBottom: spacing.sm },
  incidentBanner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  incidentAlert: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.dangerLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1.5, borderColor: colors.danger,
  },
  incidentAlertEmoji: { fontSize: 22 },
  incidentAlertContent: { flex: 1 },
  incidentAlertTitle: { fontSize: 14, fontWeight: '600', color: colors.danger },
  incidentAlertSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  incidentAlertChevron: { fontSize: 22, color: colors.danger },

  // Announcements
  annCard: {
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.md,
  },
  annTitle: { fontSize: 15, fontWeight: '700', color: colors.amber, marginBottom: spacing.sm },
  annRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  annPin: { fontSize: 14 },
  annRowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  annRowBody: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  annRowDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },

  // Attendance
  attendanceText: { fontSize: 12, color: colors.primaryDark, marginTop: spacing.sm, fontWeight: '500' },
});
