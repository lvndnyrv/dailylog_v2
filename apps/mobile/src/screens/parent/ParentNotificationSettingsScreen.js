import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useParentAccount } from '../../hooks/useParentAccount';
import { colors, fonts, radius, spacing } from '../../theme';
import { ErrorCard, LoadingCard, ParentAccountHeader } from './ParentAccountShared';

const SECTIONS = [
  {
    title: 'DAILY UPDATES',
    rows: [
      { kind: 'parent_attendance', label: 'Check-in & out', subtitle: 'When your child arrives and leaves' },
      { kind: 'parent_moments', label: 'Photos & moments', subtitle: 'New photos from the room' },
      { kind: 'parent_routines', label: 'Meals & naps', subtitle: 'Updates logged through the day' },
    ],
  },
  {
    title: 'IMPORTANT',
    rows: [
      { kind: 'parent_messages', label: 'Messages', subtitle: 'Replies from educators' },
      { kind: 'incident_report', label: 'Incident reports', subtitle: 'Always on', locked: true },
      { kind: 'medication', label: 'Medication doses', subtitle: 'Safety-critical · always on', locked: true },
      { kind: 'parent_announcements', label: 'Announcements', subtitle: 'Center and room news' },
      { kind: 'parent_schedule', label: 'Closures & room moves', subtitle: 'Calendar changes and transition plans' },
      { kind: 'parent_billing', label: 'Billing', subtitle: 'Invoices and payment reminders' },
    ],
  },
];

function timeLabel(value) {
  const [hourValue, minuteValue] = String(value || '').split(':');
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 'Not set';
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

export default function ParentNotificationSettingsScreen({ navigation }) {
  const account = useParentAccount();
  const [savingKind, setSavingKind] = useState('');
  const [savingQuiet, setSavingQuiet] = useState(false);

  useEffect(() => {
    account.refreshNotifications().catch(() => {});
  }, [account.refreshNotifications]);

  const toggle = useCallback(async (kind, enabled) => {
    setSavingKind(kind);
    try {
      await account.setNotification(kind, enabled);
    } catch (error) {
      Alert.alert('Could not save', error.message);
    } finally {
      setSavingKind('');
    }
  }, [account.setNotification]);

  async function toggleQuiet(enabled) {
    setSavingQuiet(true);
    try {
      await account.setQuietHours(enabled, '20:00', '07:00');
    } catch (error) {
      Alert.alert('Could not save', error.message);
    } finally {
      setSavingQuiet(false);
    }
  }

  const settings = account.notifications;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ParentAccountHeader navigation={navigation} title="Notifications" />
      <ScrollView contentContainerStyle={styles.content}>
        {!settings && account.loading ? <LoadingCard /> : null}
        {!settings && account.error ? (
          <ErrorCard message={account.error} onRetry={account.refreshNotifications} />
        ) : null}
        {settings ? SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((row, index) => (
                <View key={row.kind} style={[styles.row, index > 0 && styles.rowBorder]}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                  </View>
                  {row.locked ? <Ionicons name="lock-closed" size={16} color={colors.success} /> : null}
                  <Switch
                    value={row.locked || Boolean(settings.preferences?.[row.kind])}
                    disabled={row.locked || savingKind === row.kind}
                    onValueChange={(value) => toggle(row.kind, value)}
                    trackColor={{ false: '#CBD7E6', true: colors.success }}
                    thumbColor={colors.white}
                    accessibilityLabel={`${row.label} notifications`}
                  />
                </View>
              ))}
            </View>
          </View>
        )) : null}

        {settings ? (
          <View style={styles.quietCard}>
            <View style={styles.quietIcon}>
              <Ionicons name="moon-outline" size={19} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>Quiet hours</Text>
              <Text style={styles.quietTime}>
                {timeLabel(settings.quiet_hours_start)} – {timeLabel(settings.quiet_hours_end)}
              </Text>
              <Text style={styles.rowSubtitle}>Safety alerts still arrive immediately.</Text>
            </View>
            <Switch
              value={Boolean(settings.quiet_hours_enabled)}
              disabled={savingQuiet}
              onValueChange={toggleQuiet}
              trackColor={{ false: '#CBD7E6', true: colors.success }}
              thumbColor={colors.white}
              accessibilityLabel="Quiet hours notifications"
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingBottom: 42, gap: spacing.lg },
  sectionTitle: {
    color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11,
    letterSpacing: 0.7, marginBottom: spacing.sm, paddingHorizontal: 2,
  },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, overflow: 'hidden',
  },
  row: {
    minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  rowSubtitle: {
    color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5,
    marginTop: 2, lineHeight: 16,
  },
  quietCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    padding: spacing.lg,
  },
  quietIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  quietTime: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
});
