import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useClassroom } from '../../hooks/useClassroom';
import { useRollCall } from '../../hooks/useRollCall';
import { colors, fonts, radius, spacing } from '../../theme';

const STATUS_ORDER = { present: 0, absent: 1, coming: 2, awaited: 3, departed: 4 };

function initials(child) {
  return `${child.firstName?.[0] || ''}${child.lastName?.[0] || ''}`.toUpperCase();
}

function reasonLabel(reason) {
  return (reason || 'Absent').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function SummaryCard({ label, value, tone }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, tone && styles[`${tone}Value`]]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ChildRow({ child, busy, onCheckIn, onAbsent, onLatePickup }) {
  const checkedIn = child.checkedInAt ? format(new Date(child.checkedInAt), 'h:mm a') : null;
  const checkedOut = child.checkedOutAt ? format(new Date(child.checkedOutAt), 'h:mm a') : null;
  const isPresent = child.rollStatus === 'present';
  const isAbsent = child.rollStatus === 'absent';
  const isComing = child.rollStatus === 'coming';
  const isDeparted = child.rollStatus === 'departed';

  let detail = 'No response yet';
  if (isPresent) detail = `Checked in ${checkedIn}${child.method === 'kiosk' ? ' · kiosk' : ''}`;
  if (isAbsent) {
    detail = `${reasonLabel(child.absenceReason)}${child.method === 'parent' ? ' · parent reported' : ''}`;
  }
  if (isComing) detail = child.notes || 'Family said they are coming later';
  if (isDeparted) detail = `Checked out ${checkedOut}`;

  return (
    <View style={styles.childRow}>
      <View style={[
        styles.avatar,
        isAbsent && styles.avatarAbsent,
        isComing && styles.avatarComing,
      ]}>
        <Text style={[
          styles.avatarText,
          isAbsent && styles.avatarTextAbsent,
          isComing && styles.avatarTextComing,
        ]}>{initials(child)}</Text>
      </View>
      <View style={styles.childCopy}>
        <Text style={styles.childName}>{child.fullName}</Text>
        <Text style={styles.childDetail} numberOfLines={2}>{detail}</Text>
        {child.notes && (isAbsent || isPresent) && (
          <Text style={styles.childNote} numberOfLines={2}>{child.notes}</Text>
        )}
      </View>

      {isPresent ? (
        child.isLatePickup ? (
          <TouchableOpacity
            style={styles.lateButton}
            onPress={onLatePickup}
            activeOpacity={0.78}
            accessibilityRole="button"
          >
            <Text style={styles.lateButtonText}>Late pickup</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.presentBadge}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text style={styles.presentBadgeText}>In</Text>
          </View>
        )
      ) : isAbsent ? (
        <View style={styles.absentBadge}>
          <Text style={styles.absentBadgeText}>{reasonLabel(child.absenceReason)}</Text>
        </View>
      ) : isComing ? (
        <View style={styles.comingBadge}>
          <Text style={styles.comingBadgeText}>Coming</Text>
        </View>
      ) : isDeparted ? (
        <View style={styles.departedBadge}>
          <Text style={styles.departedBadgeText}>Out</Text>
        </View>
      ) : (
        <View style={styles.rowActions}>
          <TouchableOpacity
            style={[styles.checkInButton, busy && styles.disabled]}
            onPress={onCheckIn}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator size="small" color={colors.white} /> : (
              <Text style={styles.checkInButtonText}>Check in</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.absentAction}
            onPress={onAbsent}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.absentActionText}>Absent</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function RollCallScreen({ navigation }) {
  const { active: activeClassroom } = useClassroom();
  const isFocused = useIsFocused();
  const classroomId = activeClassroom?.id;
  const {
    rollCall,
    loading,
    refreshing,
    error,
    load,
    refresh,
    checkIn,
    complete,
  } = useRollCall(classroomId);
  const [busyChildId, setBusyChildId] = useState(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (isFocused) load({ quiet: true });
  }, [isFocused, load]);

  const children = useMemo(() => [...(rollCall?.children || [])].sort((a, b) => (
    (STATUS_ORDER[a.rollStatus] ?? 9) - (STATUS_ORDER[b.rollStatus] ?? 9)
      || a.fullName.localeCompare(b.fullName)
  )), [rollCall?.children]);

  async function handleCheckIn(child) {
    setBusyChildId(child.id);
    try {
      await checkIn(child.id);
    } catch (mutationError) {
      Alert.alert('Could not check in', mutationError.message);
    } finally {
      setBusyChildId(null);
    }
  }

  async function finishRollCall() {
    if (completing) return;
    setCompleting(true);
    try {
      const result = await complete();
      navigation.replace('RollCallComplete', {
        result,
        classroomName: rollCall?.classroom?.name || activeClassroom?.name,
      });
    } catch (mutationError) {
      Alert.alert('Could not complete roll call', mutationError.message);
    } finally {
      setCompleting(false);
    }
  }

  const summary = rollCall?.summary || {};
  const ratio = rollCall?.ratio || {};

  if (loading && !rollCall) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={styles.loader} color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back to classroom"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {rollCall?.classroom?.name || activeClassroom?.name || 'Classroom'} · {format(new Date(), 'EEEE, MMM d')}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={refresh} accessibilityLabel="Refresh attendance">
          <Ionicons name="refresh" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        {error && (
          <TouchableOpacity style={styles.errorCard} onPress={() => load()}>
            <Ionicons name="cloud-offline-outline" size={21} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Attendance couldn’t refresh</Text>
              <Text style={styles.errorText}>Tap to try again. No changes were made.</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.summaryRow}>
          <SummaryCard label="In" value={summary.present || 0} tone="success" />
          <SummaryCard label="Absent" value={summary.absent || 0} tone="amber" />
          <SummaryCard label="Awaited" value={summary.awaited || 0} tone="primary" />
        </View>

        <TouchableOpacity
          style={[styles.ratioBanner, ratio.is_over_ratio && styles.ratioBannerOver]}
          onPress={() => navigation.navigate('RoomRatios')}
          activeOpacity={0.78}
          accessibilityRole="button"
        >
          <View style={[styles.ratioIcon, ratio.is_over_ratio && styles.ratioIconOver]}>
            <Ionicons
              name={ratio.is_over_ratio ? 'warning-outline' : 'shield-checkmark-outline'}
              size={21}
              color={ratio.is_over_ratio ? colors.danger : colors.success}
            />
          </View>
          <View style={styles.ratioCopy}>
            <Text style={styles.ratioTitle}>
              {ratio.is_over_ratio ? `Ratio needs ${ratio.over_by} more staff` : 'Room is in ratio'}
            </Text>
            <Text style={styles.ratioText}>
              {summary.present || 0} children · {ratio.staff_count || 0} staff · limit {ratio.max_children_per_staff || '—'}:1
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        {rollCall?.completion && (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.completedText}>
              Roll call saved {format(new Date(rollCall.completion.completedAt), 'h:mm a')} · live updates remain on
            </Text>
          </View>
        )}

        <View style={styles.listCard}>
          <View style={styles.listHeading}>
            <Text style={styles.listTitle}>Classroom roll</Text>
            <Text style={styles.listMeta}>{children.length} children</Text>
          </View>
          {children.length ? children.map((child, index) => (
            <View key={child.id}>
              <ChildRow
                child={child}
                busy={busyChildId === child.id}
                onCheckIn={() => handleCheckIn(child)}
                onAbsent={() => navigation.navigate('MarkAbsent', { child })}
                onLatePickup={() => navigation.navigate('LatePickup', { child })}
              />
              {index < children.length - 1 && <View style={styles.divider} />}
            </View>
          )) : (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={28} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No children assigned</Text>
              <Text style={styles.emptyText}>Choose another classroom or ask an admin to review assignments.</Text>
            </View>
          )}
        </View>

        <View style={styles.syncNote}>
          <Ionicons name="sync-outline" size={17} color={colors.textFaint} />
          <Text style={styles.syncText}>
            Kiosk check-ins and parent-reported absences appear here automatically. Every change feeds the signed daily attendance record.
          </Text>
        </View>

        {!!children.length && (
          <TouchableOpacity
            style={[styles.completeButton, completing && styles.disabled]}
            onPress={finishRollCall}
            disabled={completing}
            accessibilityRole="button"
          >
            {completing ? <ActivityIndicator color={colors.white} /> : (
              <Text style={styles.completeButtonText}>
                {rollCall?.completion ? 'Save updated roll call' : 'Complete roll call'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  loader: { flex: 1 },
  header: {
    minHeight: 74, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerCopy: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: 24, fontFamily: fonts.black },
  subtitle: { marginTop: 2, color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  refreshButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 40 },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: '#F4CACA',
    borderRadius: radius.lg, backgroundColor: colors.dangerLight,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontSize: 13, fontFamily: fonts.bold },
  errorText: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.regular },
  summaryRow: { flexDirection: 'row', gap: spacing.sm },
  summaryCard: {
    flex: 1, minHeight: 84, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  summaryValue: { color: colors.textPrimary, fontSize: 27, fontFamily: fonts.black },
  successValue: { color: colors.success },
  amberValue: { color: colors.amber },
  primaryValue: { color: colors.primary },
  summaryLabel: { marginTop: 2, color: colors.textMuted, fontSize: 12, fontFamily: fonts.bold },
  ratioBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md,
    padding: spacing.md, borderWidth: 1.5, borderColor: '#BEE3D1',
    borderRadius: radius.lg, backgroundColor: '#F2FAF6',
  },
  ratioBannerOver: { borderColor: '#F1C9C9', backgroundColor: colors.dangerLight },
  ratioIcon: {
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
    borderRadius: 19, backgroundColor: colors.successLight,
  },
  ratioIconOver: { backgroundColor: '#F8DCDC' },
  ratioCopy: { flex: 1 },
  ratioTitle: { color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  ratioText: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.regular },
  completedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.successLight,
  },
  completedText: { flex: 1, color: colors.success, fontSize: 12, lineHeight: 17, fontFamily: fonts.bold },
  listCard: {
    marginTop: spacing.md, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden',
  },
  listHeading: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  listTitle: { color: colors.textPrimary, fontSize: 16, fontFamily: fonts.bold },
  listMeta: { color: colors.textFaint, fontSize: 12, fontFamily: fonts.regular },
  childRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  avatar: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: 21, backgroundColor: colors.primaryLight,
  },
  avatarAbsent: { backgroundColor: colors.amberLight },
  avatarComing: { backgroundColor: colors.purpleLight },
  avatarText: { color: colors.primary, fontSize: 13, fontFamily: fonts.bold },
  avatarTextAbsent: { color: colors.amber },
  avatarTextComing: { color: colors.purple },
  childCopy: { flex: 1, minWidth: 0, marginLeft: spacing.md, marginRight: spacing.sm },
  childName: { color: colors.textPrimary, fontSize: 14.5, fontFamily: fonts.bold },
  childDetail: { marginTop: 2, color: colors.textMuted, fontSize: 12, lineHeight: 16, fontFamily: fonts.regular },
  childNote: { marginTop: 2, color: colors.textFaint, fontSize: 11, lineHeight: 15, fontFamily: fonts.regular },
  rowActions: { alignItems: 'stretch', gap: 5 },
  checkInButton: {
    minWidth: 74, minHeight: 34, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  checkInButtonText: { color: colors.white, fontSize: 12, fontFamily: fonts.bold },
  absentAction: { minHeight: 25, alignItems: 'center', justifyContent: 'center' },
  absentActionText: { color: colors.amber, fontSize: 11.5, fontFamily: fonts.bold },
  presentBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 7, borderRadius: radius.full, backgroundColor: colors.successLight },
  presentBadgeText: { color: colors.success, fontSize: 11.5, fontFamily: fonts.bold },
  absentBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.amberLight },
  absentBadgeText: { color: colors.amber, fontSize: 11, fontFamily: fonts.bold },
  comingBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.purpleLight },
  comingBadgeText: { color: colors.purple, fontSize: 11, fontFamily: fonts.bold },
  departedBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.primarySoft },
  departedBadgeText: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.bold },
  lateButton: {
    minHeight: 36, justifyContent: 'center', paddingHorizontal: 10,
    borderWidth: 1.5, borderColor: '#E7C383', borderRadius: radius.md,
    backgroundColor: colors.amberLight,
  },
  lateButtonText: { color: colors.amber, fontSize: 11.5, fontFamily: fonts.bold },
  divider: { height: 1, marginLeft: 66, backgroundColor: colors.borderSoft },
  emptyState: { alignItems: 'center', padding: spacing.xxl },
  emptyTitle: { marginTop: spacing.sm, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  emptyText: { marginTop: 3, textAlign: 'center', color: colors.textMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  syncNote: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.sm },
  syncText: { flex: 1, color: colors.textFaint, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  completeButton: {
    minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  completeButtonText: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  disabled: { opacity: 0.55 },
});
