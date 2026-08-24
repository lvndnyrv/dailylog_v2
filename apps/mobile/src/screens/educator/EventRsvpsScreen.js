import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import {
  getEventRsvpSummary,
  remindEventNonresponders,
} from '../../hooks/useStaffVisibility';
import { EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const RESPONSE_META = {
  yes: { label: 'Going', color: colors.success, bg: colors.successLight, icon: 'checkmark' },
  maybe: { label: 'Maybe', color: colors.amber, bg: colors.amberLight, icon: 'help' },
  no: { label: "Can't", color: colors.danger, bg: colors.dangerLight, icon: 'close' },
  no_reply: { label: 'No reply', color: colors.textMuted, bg: colors.primarySoft, icon: 'time-outline' },
};

function eventDate(value, endsAt) {
  if (!value) return 'Date to be confirmed';
  const starts = new Date(value);
  const end = endsAt ? new Date(endsAt) : null;
  return `${format(starts, 'EEE, MMM d · h:mm a')}${end ? `–${format(end, 'h:mm a')}` : ''}`;
}

export default function EventRsvpsScreen({ navigation, route }) {
  const announcementId = route.params?.announcementId || route.params?.announcement?.id;
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    if (!announcementId) {
      setError('This event could not be identified.');
      setLoading(false);
      return;
    }
    setError('');
    try {
      setSummary(await getEventRsvpSummary(announcementId));
    } catch (loadError) {
      setError(loadError.message || 'The response list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [announcementId]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  function confirmReminder() {
    const count = summary?.counts?.noReply || 0;
    if (!count) return;
    Alert.alert(
      'Remind non-responders?',
      `${count} ${count === 1 ? 'family has' : 'families have'} not replied. Each household will receive one reminder today.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send reminder', onPress: sendReminder },
      ],
    );
  }

  async function sendReminder() {
    setReminding(true);
    try {
      const queued = await remindEventNonresponders(announcementId);
      showToast(
        queued > 0
          ? `${queued} ${queued === 1 ? 'reminder' : 'reminders'} queued`
          : 'Families were already reminded today',
        'success',
      );
    } catch (reminderError) {
      Alert.alert('Could not send reminders', reminderError.message || 'Please try again.');
    } finally {
      setReminding(false);
    }
  }

  function renderFamily({ item }) {
    const meta = RESPONSE_META[item.response] || RESPONSE_META.no_reply;
    return (
      <View style={styles.familyRow}>
        <View style={[styles.avatar, { backgroundColor: meta.bg }]}>
          <Text style={[styles.avatarText, { color: meta.color }]}>
            {(item.familyName || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.familyCopy}>
          <Text style={styles.familyName}>{item.familyName}</Text>
          <Text style={styles.childNames}>{item.childNames || 'Linked family'}</Text>
          {item.responderName ? (
            <Text style={styles.respondedBy}>Replied by {item.responderName}</Text>
          ) : null}
        </View>
        <View style={styles.responseRight}>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon} size={13} color={meta.color} />
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {item.response !== 'no_reply' && item.response !== 'no' ? (
            <Text style={styles.guests}>{item.guests} {item.guests === 1 ? 'guest' : 'guests'}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  const counts = summary?.counts || {};
  const event = summary?.event;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>RSVPs</Text>
          <Text style={styles.headerSubtitle}>Family responses</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="⚠️" message={error} />
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={summary?.families || []}
          keyExtractor={(item) => item.familyId}
          renderItem={renderFamily}
          contentContainerStyle={styles.content}
          ListHeaderComponent={(
            <>
              <View style={styles.eventCard}>
                <View style={styles.eventIcon}>
                  <Ionicons name="calendar-outline" size={23} color={colors.primary} />
                </View>
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>{event?.title}</Text>
                  <Text style={styles.eventMeta}>{eventDate(event?.eventAt, event?.eventEndsAt)}</Text>
                  {event?.location ? (
                    <Text style={styles.eventLocation} numberOfLines={2}>
                      <Ionicons name="location-outline" size={13} color={colors.textMuted} /> {event.location}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.countGrid}>
                {[
                  ['Going', counts.going || 0, RESPONSE_META.yes],
                  ['Maybe', counts.maybe || 0, RESPONSE_META.maybe],
                  ["Can't", counts.no || 0, RESPONSE_META.no],
                  ['No reply', counts.noReply || 0, RESPONSE_META.no_reply],
                ].map(([label, value, meta]) => (
                  <View key={label} style={styles.countCard}>
                    <Text style={[styles.countNumber, { color: meta.color }]}>{value}</Text>
                    <Text style={styles.countLabel}>{label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.listHeadingRow}>
                <Text style={styles.listHeading}>FAMILIES</Text>
                <Text style={styles.listHint}>{summary?.families?.length || 0} invited</Text>
              </View>
            </>
          )}
          ListEmptyComponent={<EmptyState icon="👪" message="No eligible families are linked to this event yet." />}
          ListFooterComponent={counts.noReply > 0 ? (
            <TouchableOpacity
              style={styles.remindButton}
              onPress={confirmReminder}
              disabled={reminding}
              activeOpacity={0.78}
            >
              {reminding ? <ActivityIndicator color={colors.white} /> : (
                <>
                  <Ionicons name="notifications-outline" size={18} color={colors.white} />
                  <Text style={styles.remindText}>Remind {counts.noReply} non-{counts.noReply === 1 ? 'responder' : 'responders'}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.completeCard}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.completeText}>Every invited family has responded.</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 70, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight,
  },
  backButton: { width: 38, height: 44, justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary, textAlign: 'center' },
  headerSubtitle: { marginTop: 2, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted, textAlign: 'center' },
  headerSpacer: { width: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 54 },
  eventCard: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg,
    borderRadius: 20, backgroundColor: colors.primary, marginBottom: spacing.lg,
  },
  eventIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  eventCopy: { flex: 1 },
  eventTitle: { fontSize: 18, fontFamily: fonts.black, color: colors.white },
  eventMeta: { marginTop: 5, fontSize: 13, fontFamily: fonts.bold, color: '#EAF3FF' },
  eventLocation: { marginTop: 4, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: '#EAF3FF' },
  countGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  countCard: {
    flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: spacing.md,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
  },
  countNumber: { fontSize: 23, fontFamily: fonts.black },
  countLabel: { marginTop: 3, fontSize: 10.5, fontFamily: fonts.bold, color: colors.textMuted, textAlign: 'center' },
  listHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  listHeading: { fontSize: 11.5, letterSpacing: 0.9, fontFamily: fonts.bold, color: colors.textFaint },
  listHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint },
  familyRow: {
    minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.primarySoft,
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: fonts.bold },
  familyCopy: { flex: 1, minWidth: 0 },
  familyName: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  childNames: { marginTop: 2, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted },
  respondedBy: { marginTop: 2, fontSize: 10.5, fontFamily: fonts.regular, color: colors.textFaint },
  responseRight: { alignItems: 'flex-end', gap: 5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 11.5, fontFamily: fonts.bold },
  guests: { fontSize: 10.5, fontFamily: fonts.regular, color: colors.textMuted },
  remindButton: {
    minHeight: 50, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl,
  },
  remindText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.white },
  completeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, marginTop: spacing.lg },
  completeText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.success },
  retryButton: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { fontFamily: fonts.bold, color: colors.primary },
});
