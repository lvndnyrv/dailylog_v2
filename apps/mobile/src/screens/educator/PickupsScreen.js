import React, { useEffect, useMemo } from 'react';
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
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { useClassroom } from '../../hooks/useClassroom';
import { useTodayPickups } from '../../hooks/usePickupVerification';
import { colors, fonts, radius, spacing } from '../../theme';

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();
}

function timeLabel(value) {
  if (!value) return 'Time not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time not set' : `~ ${format(date, 'h:mm a')}`;
}

function PickupRow({ pickup, completed, onVerify }) {
  return (
    <View style={styles.pickupRow}>
      <View style={[styles.avatar, completed && styles.avatarCompleted]}>
        <Text style={[styles.avatarText, completed && styles.avatarTextCompleted]}>
          {initials(pickup.child_name)}
        </Text>
      </View>
      <View style={styles.pickupCopy}>
        <Text style={styles.childName} numberOfLines={1}>{pickup.child_name}</Text>
        <Text style={styles.presenterText} numberOfLines={1}>
          {pickup.presenter_name}
          {pickup.relationship ? ` · ${pickup.relationship}` : ''}
        </Text>
        <Text style={styles.pickupTime}>
          {completed
            ? `Checked out ${format(new Date(pickup.checked_out_at), 'h:mm a')}`
            : timeLabel(pickup.scheduled_for)}
        </Text>
      </View>
      {completed ? (
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={16} color={colors.success} />
        </View>
      ) : (
        <View style={styles.rowActionWrap}>
          {pickup.has_active_pass && (
            <Text style={styles.passReady}>Pass ready</Text>
          )}
          <TouchableOpacity
            style={styles.verifyButton}
            onPress={() => onVerify(pickup)}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Verify pickup for ${pickup.child_name}`}
          >
            <Text style={styles.verifyButtonText}>Verify</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function PickupsScreen({ navigation }) {
  const { active } = useClassroom();
  const { pickups, loading, error, load } = useTodayPickups(active?.id);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused && active?.id) load({ quiet: pickups.length > 0 });
  }, [active?.id, isFocused, load]);

  const expected = useMemo(
    () => pickups.filter((pickup) => pickup.pickup_status !== 'completed'),
    [pickups]
  );
  const completed = useMemo(
    () => pickups.filter((pickup) => pickup.pickup_status === 'completed'),
    [pickups]
  );

  function verify(pickup) {
    navigation.navigate('VerifyPickup', { pickup });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Pickups</Text>
          <ClassroomSwitcher compact childCount={pickups.length} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={loading && pickups.length > 0} onRefresh={() => load()} />
        )}
      >
        <View style={styles.scanCard}>
          <View style={styles.scanIcon}>
            <Ionicons name="scan-outline" size={26} color={colors.primary} />
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanTitle}>Verify at the door</Text>
            <Text style={styles.scanText}>Scan the family pass before releasing a child.</Text>
          </View>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => navigation.navigate('VerifyPickup')}
            accessibilityRole="button"
          >
            <Text style={styles.scanButtonText}>Scan pass</Text>
          </TouchableOpacity>
        </View>

        {loading && !pickups.length ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.primary} />
        ) : error ? (
          <View style={styles.messageCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
            <Text style={styles.messageTitle}>Pickups are unavailable</Text>
            <Text style={styles.messageText}>{error.message}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => load()}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !pickups.length ? (
          <View style={styles.messageCard}>
            <Ionicons name="time-outline" size={30} color={colors.textFaint} />
            <Text style={styles.messageTitle}>No pickups yet</Text>
            <Text style={styles.messageText}>
              Children appear here after they are checked in for the day.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Expected today</Text>
              <View style={styles.countBadge}><Text style={styles.countText}>{expected.length}</Text></View>
            </View>
            <View style={styles.listCard}>
              {expected.length ? expected.map((pickup, index) => (
                <View key={pickup.child_id}>
                  {index > 0 && <View style={styles.divider} />}
                  <PickupRow pickup={pickup} onVerify={verify} />
                </View>
              )) : (
                <View style={styles.allDone}>
                  <Ionicons name="checkmark-circle" size={25} color={colors.success} />
                  <Text style={styles.allDoneText}>All expected pickups are complete.</Text>
                </View>
              )}
            </View>

            {completed.length > 0 && (
              <>
                <View style={[styles.sectionHeading, styles.completedHeading]}>
                  <Text style={styles.sectionTitle}>Checked out</Text>
                  <Text style={styles.completedCount}>{completed.length} today</Text>
                </View>
                <View style={styles.listCard}>
                  {completed.map((pickup, index) => (
                    <View key={pickup.child_id}>
                      {index > 0 && <View style={styles.divider} />}
                      <PickupRow pickup={pickup} completed />
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <View style={styles.safetyNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.textFaint} />
          <Text style={styles.safetyText}>
            Every verified release is time-stamped, signed by you, and shared with the family.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.primarySoft,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 23, fontFamily: fonts.black, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  scanCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryLight,
    marginBottom: spacing.xl,
  },
  scanIcon: {
    width: 48, height: 48, borderRadius: radius.lg, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  scanCopy: { flex: 1, minWidth: 0 },
  scanTitle: { fontSize: 15, fontFamily: fonts.black, color: colors.textPrimary },
  scanText: { marginTop: 2, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular, color: colors.textMuted },
  scanButton: {
    minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  scanButtonText: { color: colors.white, fontSize: 12.5, fontFamily: fonts.bold },
  loader: { marginTop: 70 },
  messageCard: {
    alignItems: 'center', padding: spacing.xl, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  messageTitle: { marginTop: spacing.sm, fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary },
  messageText: {
    marginTop: spacing.xs, fontSize: 12.5, lineHeight: 18, textAlign: 'center',
    fontFamily: fonts.regular, color: colors.textMuted,
  },
  retryButton: { marginTop: spacing.md, padding: spacing.sm },
  retryText: { color: colors.primary, fontFamily: fonts.bold },
  sectionHeading: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  completedHeading: { marginTop: spacing.xl },
  sectionTitle: { fontSize: 16, fontFamily: fonts.black, color: colors.textPrimary },
  countBadge: {
    minWidth: 27, height: 27, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, backgroundColor: colors.amberLight,
  },
  countText: { color: colors.amber, fontSize: 12, fontFamily: fonts.bold },
  completedCount: { marginLeft: 'auto', color: colors.textFaint, fontSize: 12, fontFamily: fonts.regular },
  listCard: {
    overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  pickupRow: {
    minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  avatar: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: 21, backgroundColor: colors.primaryLight,
  },
  avatarCompleted: { backgroundColor: colors.successLight },
  avatarText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  avatarTextCompleted: { color: colors.success },
  pickupCopy: { flex: 1, minWidth: 0 },
  childName: { fontSize: 14.5, fontFamily: fonts.black, color: colors.textPrimary },
  presenterText: { marginTop: 2, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary },
  pickupTime: { marginTop: 2, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textFaint },
  rowActionWrap: { alignItems: 'flex-end', gap: spacing.xs },
  passReady: { fontSize: 10.5, fontFamily: fonts.bold, color: colors.success },
  verifyButton: {
    minHeight: 36, justifyContent: 'center', paddingHorizontal: 15,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
  },
  verifyButtonText: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  doneIcon: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    borderRadius: 15, backgroundColor: colors.successLight,
  },
  divider: { height: 1, marginLeft: 66, backgroundColor: colors.borderSoft },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  allDoneText: { color: colors.success, fontSize: 13, fontFamily: fonts.bold },
  safetyNote: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, paddingHorizontal: spacing.sm },
  safetyText: { flex: 1, color: colors.textFaint, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
});
