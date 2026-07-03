import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { useDailyLog } from '../../hooks/useDailyLog';
import { LoadingScreen, Badge, EmptyState, Divider } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday } from 'date-fns';

const MOOD_EMOJI = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };
const AMOUNT_STYLE = {
  all: { color: colors.success, bg: colors.successLight },
  some: { color: colors.amber, bg: colors.amberLight },
  none: { color: colors.danger, bg: colors.dangerLight },
};

export default function ParentHomeScreen({ navigation }) {
  const { profile } = useAuth();
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loadingChildren, setLoadingChildren] = useState(true);

  const {
    log, meals, diapers, sleeps, activities, supplies, loading,
  } = useDailyLog(selectedChild?.id, selectedDate);

  useEffect(() => {
    async function fetchChildren() {
      const { data } = await supabase
        .from('parent_children')
        .select('child:children(*)')
        .eq('parent_id', profile.id);

      const kids = data?.map(r => r.child) || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0]);
      setLoadingChildren(false);
    }
    if (profile) fetchChildren();
  }, [profile]);

  if (loadingChildren || loading) return <LoadingScreen />;

  if (!children.length) {
    return (
      <View style={styles.container}>
        <EmptyState icon="👶" message="No children linked to your account yet.\nAsk your daycare to add you." />
      </View>
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
});
