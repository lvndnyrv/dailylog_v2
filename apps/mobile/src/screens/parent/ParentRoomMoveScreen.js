import React, { useCallback, useMemo } from 'react';
import {
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

import { useParentSchedule } from '../../hooks/useParentSchedule';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  money,
  ScheduleEmpty,
  ScheduleError,
  ScheduleHeader,
  ScheduleLoading,
  scheduleDate,
  scheduleStyles,
} from './ParentScheduleShared';

export default function ParentRoomMoveScreen({ navigation, route }) {
  const schedule = useParentSchedule();

  useFocusEffect(useCallback(() => {
    schedule.refresh().catch(() => {});
  }, [schedule.refresh]));

  const plan = useMemo(() => {
    const rows = schedule.hub?.room_moves || [];
    if (route.params?.transitionId) {
      return rows.find((item) => item.id === route.params.transitionId) || null;
    }
    if (route.params?.childId) {
      return rows.find((item) => item.child_id === route.params.childId) || null;
    }
    return rows.find((item) => item.move_on >= schedule.hub?.today) || rows[0] || null;
  }, [route.params?.childId, route.params?.transitionId, schedule.hub]);

  if (!schedule.hub && schedule.loading) {
    return <SafeAreaView style={scheduleStyles.safeArea}><ScheduleLoading /></SafeAreaView>;
  }
  if (!schedule.hub && schedule.error) {
    return (
      <SafeAreaView style={scheduleStyles.safeArea}>
        <ScheduleError message={schedule.error} onRetry={schedule.refresh} />
      </SafeAreaView>
    );
  }
  if (!plan) {
    return (
      <SafeAreaView style={scheduleStyles.safeArea}>
        <ScheduleEmpty
          icon="school-outline"
          title={route.params?.transitionId ? 'This room move changed' : 'No room move planned'}
          body={route.params?.transitionId
            ? 'The plan was cancelled or is no longer shared. Today always shows the latest room information.'
            : 'When the office schedules a room transition, the complete plan will appear here.'}
          onBack={() => navigation.navigate('ParentTabs', { screen: 'ParentHome' })}
        />
      </SafeAreaView>
    );
  }

  const newRate = money(plan.new_tuition_cents, plan.currency);
  const oldRate = money(plan.current_tuition_cents, plan.currency);
  const completed = plan.status === 'completed';
  const overdue = plan.status === 'planned' && plan.move_on < schedule.hub.today;

  return (
    <SafeAreaView style={scheduleStyles.safeArea}>
      <ScheduleHeader navigation={navigation} title={completed ? `${plan.child_first_name}'s new room` : `A change for ${plan.child_first_name}`} />
      <ScrollView
        contentContainerStyle={scheduleStyles.content}
        refreshControl={(
          <RefreshControl
            refreshing={schedule.loading && Boolean(schedule.hub)}
            onRefresh={() => schedule.refresh().catch(() => {})}
            tintColor={colors.primary}
          />
        )}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroText}>
            {completed
              ? `${plan.child_first_name} is now part of the ${plan.to_room_name} room.`
              : plan.family_message
                || `${plan.child_first_name} is ready to move up — they'll join the ${plan.to_room_name} room.`}
          </Text>
          <View style={styles.roomFlow}>
            <RoomBox label="FROM" name={plan.from_room_name} />
            <Ionicons name="arrow-forward" size={21} color={colors.primary} />
            <RoomBox label="TO" name={plan.to_room_name} selected />
          </View>
        </View>

        <View style={styles.timeline}>
          <TimelineRow
            icon="calendar-outline"
            title={`${completed ? 'Moved' : 'Move day'} · ${scheduleDate(plan.move_on, 'EEE MMM d')}`}
            body={completed ? `First full day in ${plan.to_room_name}.` : `Planned first full day in ${plan.to_room_name}.`}
          />
          {plan.transition_week && plan.transition_starts_on ? (
            <TimelineRow
              icon="people-outline"
              title={`Transition week · ${scheduleDate(plan.transition_starts_on, 'MMM d')}–${scheduleDate(plan.transition_ends_on, 'd')}`}
              body={`Short visits to ${plan.to_room_name} so it feels familiar before move day.`}
            />
          ) : null}
          {newRate ? (
            <TimelineRow
              icon="card-outline"
              title={`New rate from ${scheduleDate(plan.move_on, 'MMM d')}`}
              body={`${plan.to_room_name} tuition is ${newRate} / mo${oldRate ? ` (was ${oldRate})` : ''}. Your office will reflect the change on the next invoice it issues.`}
              last
            />
          ) : (
            <TimelineRow
              icon="card-outline"
              title="Tuition"
              body="The office will confirm any tuition change before the move."
              last
            />
          )}
        </View>

        <View style={[styles.reassurance, overdue && styles.overdueCard]}>
          <Ionicons name={overdue ? 'time-outline' : 'checkmark'} size={20} color={overdue ? colors.amber : colors.success} />
          <Text style={[styles.reassuranceText, overdue && styles.overdueText]}>
            {completed
              ? `${plan.child_first_name}'s room assignment has been updated. The center can help with any settling-in questions.`
              : overdue
                ? 'The planned move date has passed. The office is confirming the current room assignment; message them for an update.'
                : 'The gradual transition keeps routines familiar. The current room remains assigned until move day.'}
          </Text>
        </View>

        <TouchableOpacity
          style={scheduleStyles.primaryButton}
          onPress={() => navigation.navigate('Messaging', {
            childId: plan.child_id,
            childName: plan.child_first_name,
          })}
          accessibilityRole="button"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.white} />
          <Text style={scheduleStyles.primaryButtonText}>Questions? Message us</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomBox({ label, name, selected = false }) {
  return (
    <View style={[styles.roomBox, selected && styles.roomBoxSelected]}>
      <Text style={[styles.roomLabel, selected && styles.roomLabelSelected]}>{label}</Text>
      <Text style={[styles.roomName, selected && styles.roomNameSelected]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

function TimelineRow({ icon, title, body, last = false }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineIcon}>
          <Ionicons name={icon} size={17} color={colors.primary} />
        </View>
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={[styles.timelineCopy, !last && styles.timelineCopySpacing]}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={styles.timelineBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: colors.primaryLight, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.lg,
  },
  heroText: {
    color: colors.textSecondary, fontFamily: fonts.regular,
    fontSize: 13.5, lineHeight: 21,
  },
  roomFlow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roomBox: {
    flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.md,
  },
  roomBoxSelected: { backgroundColor: colors.primary },
  roomLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5 },
  roomLabelSelected: { color: '#DDEBFB' },
  roomName: {
    color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14, marginTop: 2,
  },
  roomNameSelected: { color: colors.white },
  timeline: { paddingHorizontal: 2 },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { width: 36, alignItems: 'center' },
  timelineIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineLine: { width: 1.5, flex: 1, minHeight: 16, backgroundColor: colors.border },
  timelineCopy: { flex: 1, minWidth: 0, paddingTop: 5 },
  timelineCopySpacing: { paddingBottom: spacing.lg },
  timelineTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  timelineBody: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13,
    lineHeight: 19, marginTop: 3,
  },
  reassurance: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.successLight, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  reassuranceText: {
    flex: 1, color: '#1B6B45', fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18,
  },
  overdueCard: { backgroundColor: colors.amberLight },
  overdueText: { color: '#8A6D3B' },
});
