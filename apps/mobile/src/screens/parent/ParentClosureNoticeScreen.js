import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
  ScheduleEmpty,
  ScheduleError,
  ScheduleLoading,
  scheduleDate,
  scheduleDateRange,
  scheduleStyles,
  timeLabel,
} from './ParentScheduleShared';

export default function ParentClosureNoticeScreen({ navigation, route }) {
  const schedule = useParentSchedule();
  const [adding, setAdding] = useState(false);

  useFocusEffect(useCallback(() => {
    schedule.refresh().catch(() => {});
  }, [schedule.refresh]));

  const closure = useMemo(() => {
    const rows = schedule.hub?.closures || [];
    if (route.params?.closureId) {
      return rows.find((item) => item.id === route.params.closureId) || null;
    }
    return rows.find((item) => item.ends_on >= schedule.hub?.today) || rows[0] || null;
  }, [route.params?.closureId, schedule.hub]);

  async function addToCalendar() {
    setAdding(true);
    try {
      await schedule.addClosureToCalendar(closure, schedule.hub?.daycare);
    } catch (error) {
      Alert.alert('Calendar unavailable', error.message);
    } finally {
      setAdding(false);
    }
  }

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
  if (!closure) {
    return (
      <SafeAreaView style={scheduleStyles.safeArea}>
        <ScheduleEmpty
          title="No closure to show"
          body={route.params?.closureId
            ? 'This closure was cancelled or is no longer published. Your current closure calendar is still available.'
            : 'The office has not published any upcoming closures.'}
          onBack={route.params?.closureId
            ? () => navigation.replace('ParentClosures')
            : () => navigation.navigate('ParentTabs', { screen: 'ParentHome' })}
          actionLabel={route.params?.closureId ? 'See current closures' : 'Back to Today'}
        />
      </SafeAreaView>
    );
  }

  const daycare = schedule.hub?.daycare;
  const reopens = closure.reopens_on;
  const range = scheduleDateRange(closure.starts_on, closure.ends_on);

  return (
    <SafeAreaView style={scheduleStyles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroIcon}>
          <Ionicons name="calendar-outline" size={32} color={colors.amber} />
        </View>

        <View style={styles.heroCopy}>
          <Text style={styles.title}>
            {daycare?.name || 'Your center'} is closed{`\n`}{range}
          </Text>
          <Text style={styles.body}>
            {closure.family_message
              || `The whole center is closed. No drop-off — we'll see your family again on the next open day.`}
          </Text>
        </View>

        <View style={styles.reasonBadge}>
          <Text style={styles.reasonText}>Reason: {closure.reason}</Text>
        </View>

        <View style={styles.detailsCard}>
          <DetailRow label="When" value={`${scheduleDateRange(closure.starts_on, closure.ends_on)} · all day`} />
          <DetailRow
            label="Reopens"
            value={`${scheduleDate(reopens, 'EEE MMM d')} · ${timeLabel(daycare?.opens_at)}`}
          />
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Billing</Text>
            <View style={styles.noChargeBadge}>
              <Ionicons name="checkmark" size={13} color={colors.success} />
              <Text style={styles.noChargeText}>
                No charge
              </Text>
            </View>
          </View>
        </View>

        {closure.reminder_days_before > 0 ? (
          <View style={scheduleStyles.infoCard}>
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <Text style={scheduleStyles.infoText}>
              We&apos;ll remind you {closure.reminder_days_before} days before.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[scheduleStyles.primaryButton, adding && styles.disabled]}
          onPress={addToCalendar}
          disabled={adding}
          accessibilityRole="button"
        >
          <Ionicons name="calendar" size={18} color={colors.white} />
          <Text style={scheduleStyles.primaryButtonText}>
            {adding ? 'Opening calendar…' : 'Add to my calendar'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={scheduleStyles.secondaryLink}
          onPress={() => navigation.replace('ParentClosures')}
        >
          <Text style={scheduleStyles.secondaryLinkText}>See all closures</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }) {
  return (
    <View style={[styles.detailRow, styles.detailBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 26, paddingTop: spacing.lg, paddingBottom: 42,
    alignItems: 'center', gap: spacing.lg,
  },
  heroIcon: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: colors.amberLight,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCopy: { alignItems: 'center', gap: spacing.sm },
  title: {
    color: colors.textPrimary, fontFamily: fonts.black, fontSize: 23,
    lineHeight: 29, textAlign: 'center',
  },
  body: {
    color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5,
    lineHeight: 21, textAlign: 'center',
  },
  reasonBadge: {
    backgroundColor: colors.amberLight, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  reasonText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 12 },
  detailsCard: {
    width: '100%', backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: 18, paddingHorizontal: spacing.lg,
  },
  detailRow: {
    minHeight: 54, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.md,
  },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  detailLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  detailValue: {
    flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13,
    textAlign: 'right',
  },
  noChargeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.successLight, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  noChargeText: { color: colors.success, fontFamily: fonts.bold, fontSize: 12.5 },
  disabled: { opacity: 0.65 },
});
