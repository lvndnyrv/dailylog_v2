import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDays, format, parseISO } from 'date-fns';
import { isAdminRole } from '@dailylog/shared';

import { Button, Input, LoadingScreen } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import { showToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function todayValue() {
  return format(new Date(), 'yyyy-MM-dd');
}

function dateRange(closure) {
  if (!closure?.starts_on) return 'Date not set';
  if (!closure.ends_on || closure.starts_on === closure.ends_on) {
    return format(parseISO(closure.starts_on), 'EEEE, MMMM d, yyyy');
  }
  return `${format(parseISO(closure.starts_on), 'MMM d')} – ${format(parseISO(closure.ends_on), 'MMM d, yyyy')}`;
}

function ClosureCard({ closure, canManage, onCancel }) {
  const upcoming = closure.ends_on >= todayValue();
  return (
    <View style={[styles.closureCard, upcoming && styles.upcomingCard]}>
      <View style={[styles.dateTile, upcoming && styles.dateTileUpcoming]}>
        <Text style={[styles.dateDay, upcoming && styles.amberText]}>{format(parseISO(closure.starts_on), 'd')}</Text>
        <Text style={[styles.dateMonth, upcoming && styles.amberText]}>{format(parseISO(closure.starts_on), 'MMM').toUpperCase()}</Text>
      </View>
      <View style={styles.closureCopy}>
        <Text style={styles.closureReason}>{closure.reason}</Text>
        <Text style={styles.closureDate}>{dateRange(closure)}</Text>
        {closure.family_message ? (
          <Text style={styles.familyMessage} numberOfLines={2}>{closure.family_message}</Text>
        ) : null}
        <View style={styles.badgeRow}>
          <View style={styles.noChargeBadge}>
            <Ionicons name="checkmark" size={12} color={colors.success} />
            <Text style={styles.noChargeText}>No charge</Text>
          </View>
          {closure.family_visible ? (
            <View style={styles.familyBadge}>
              <Ionicons name="people-outline" size={12} color={colors.primary} />
              <Text style={styles.familyBadgeText}>Families notified</Text>
            </View>
          ) : null}
        </View>
      </View>
      {canManage && upcoming ? (
        <TouchableOpacity
          style={styles.cancelIcon}
          onPress={() => onCancel(closure)}
          accessibilityRole="button"
          accessibilityLabel={`Cancel ${closure.reason} closure`}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function AddClosureSheet({ visible, daycareId, onClose, onSaved }) {
  const initialDate = format(addDays(new Date(), 14), 'yyyy-MM-dd');
  const [startsOn, setStartsOn] = useState(initialDate);
  const [endsOn, setEndsOn] = useState(initialDate);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [reminderDays, setReminderDays] = useState('3');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function reset() {
    const nextDate = format(addDays(new Date(), 14), 'yyyy-MM-dd');
    setStartsOn(nextDate);
    setEndsOn(nextDate);
    setReason('');
    setMessage('');
    setReminderDays('3');
    setErrors({});
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  async function save() {
    const days = Number(reminderDays);
    const nextErrors = {};
    if (!startsOn) nextErrors.startsOn = 'Choose the first closed day.';
    if (!endsOn) nextErrors.endsOn = 'Choose the last closed day.';
    if (startsOn && endsOn && endsOn < startsOn) nextErrors.endsOn = 'The end date cannot be before the start.';
    if (!reason.trim()) nextErrors.reason = 'Enter a reason families and staff will recognize.';
    if (!Number.isInteger(days) || days < 0 || days > 30) nextErrors.reminderDays = 'Use a whole number from 0 to 30.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    const { error } = await supabase.from('center_closures').insert({
      daycare_id: daycareId,
      starts_on: startsOn,
      ends_on: endsOn,
      reason: reason.trim(),
      family_message: message.trim() || null,
      family_visible: true,
      billing_treatment: 'no_charge',
      reminder_days_before: days,
      published_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      setErrors({ form: error.message });
      return;
    }
    reset();
    onClose();
    showToast('Closure published to families and staff', 'success');
    onSaved();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={close} />
        <KeyboardAwareScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.sheetTitle}>Add a closure</Text>
              <Text style={styles.sheetSubtitle}>Calendar, family reminders and operations update together.</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={close} accessibilityLabel="Close add closure">
              <Ionicons name="close" size={19} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.dateFields}>
            <View style={styles.dateField}>
              <DatePickerField
                label="First closed day *"
                value={startsOn}
                onChange={(value) => {
                  setStartsOn(value);
                  if (!endsOn || endsOn < value) setEndsOn(value);
                  setErrors(current => ({ ...current, startsOn: null, endsOn: null }));
                }}
                error={errors.startsOn}
              />
            </View>
            <View style={styles.dateField}>
              <DatePickerField
                label="Through *"
                value={endsOn}
                onChange={(value) => {
                  setEndsOn(value);
                  setErrors(current => ({ ...current, endsOn: null }));
                }}
                error={errors.endsOn}
              />
            </View>
          </View>
          <Input
            label="Reason *"
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              setErrors(current => ({ ...current, reason: null, form: null }));
            }}
            placeholder="Staff professional development"
            error={errors.reason}
          />
          <Text style={styles.inputLabel}>Message to families (optional)</Text>
          <TextInput
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            placeholder="The whole center is closed. We will see your family on the next open day."
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={4000}
          />
          <Input
            label="Remind families days before *"
            value={reminderDays}
            onChangeText={(value) => {
              setReminderDays(value.replace(/[^0-9]/g, ''));
              setErrors(current => ({ ...current, reminderDays: null, form: null }));
            }}
            keyboardType="number-pad"
            error={errors.reminderDays}
          />

          <View style={styles.publishNote}>
            <Ionicons name="notifications-outline" size={20} color={colors.success} />
            <Text style={styles.publishNoteText}>
              Families are notified now, receive the scheduled reminder, and see this as a no-charge day.
            </Text>
          </View>
          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          <View style={styles.sheetActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={close} disabled={saving}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <Button label="Publish closure" onPress={save} loading={saving} style={styles.publishButton} />
          </View>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
}

export default function CenterClosuresScreen({ navigation }) {
  const { profile } = useAuth();
  const canManage = isAdminRole(profile?.role);
  const [daycare, setDaycare] = useState(null);
  const [closures, setClosures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile?.daycare_id) return;
    quiet ? setRefreshing(true) : setLoading(true);
    setError('');
    const [daycareResult, closureResult] = await Promise.all([
      supabase.from('daycares').select('id,name,opens_at,closes_at').eq('id', profile.daycare_id).maybeSingle(),
      supabase.from('center_closures').select('*').eq('daycare_id', profile.daycare_id).order('starts_on', { ascending: true }),
    ]);
    const loadError = daycareResult.error || closureResult.error;
    if (loadError) setError(loadError.message || 'The center calendar could not be loaded.');
    else {
      setDaycare(daycareResult.data);
      setClosures(closureResult.data || []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.daycare_id]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const grouped = useMemo(() => ({
    upcoming: closures.filter(item => item.ends_on >= todayValue()),
    past: closures.filter(item => item.ends_on < todayValue()).reverse().slice(0, 8),
  }), [closures]);

  function cancelClosure(closure) {
    Alert.alert(
      'Cancel this closure?',
      `${closure.reason} will be removed. Families will receive a cancellation notice and pending reminders will be stopped.`,
      [
        { text: 'Keep closure', style: 'cancel' },
        {
          text: 'Cancel closure',
          style: 'destructive',
          onPress: async () => {
            const { error: deleteError } = await supabase.from('center_closures').delete().eq('id', closure.id);
            if (deleteError) {
              Alert.alert('Could not cancel closure', deleteError.message);
              return;
            }
            showToast('Closure cancelled and families notified', 'success');
            load({ quiet: true });
          },
        },
      ],
    );
  }

  if (loading && !daycare) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.pageTitle}>{canManage ? 'Center closures' : 'Center calendar'}</Text>
          <Text style={styles.pageSubtitle}>{daycare?.name || 'Your center'} · closed days and reminders</Text>
        </View>
        {canManage ? (
          <TouchableOpacity style={styles.addButton} onPress={() => setAdding(true)} accessibilityRole="button">
            <Ionicons name="add" size={19} color={colors.white} />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ quiet: true })} tintColor={colors.primary} />}
      >
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="cloud-offline-outline" size={21} color={colors.danger} />
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Could not load the calendar</Text>
              <Text style={styles.errorBody}>{error}</Text>
            </View>
            <TouchableOpacity onPress={() => load()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}><Ionicons name="calendar-outline" size={23} color={colors.amber} /></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle}>{grouped.upcoming.length} upcoming {grouped.upcoming.length === 1 ? 'closure' : 'closures'}</Text>
            <Text style={styles.summaryBody}>
              {canManage
                ? 'Publishing updates the family calendar, reminders, billing treatment and operational checks.'
                : 'Administrators publish changes here. Check before planning attendance, coverage or family activities.'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>UPCOMING</Text>
        {grouped.upcoming.length ? grouped.upcoming.map(closure => (
          <ClosureCard key={closure.id} closure={closure} canManage={canManage} onCancel={cancelClosure} />
        )) : (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={27} color={colors.primary} />
            <Text style={styles.emptyTitle}>No upcoming closures</Text>
            <Text style={styles.emptyBody}>{canManage ? 'Add a holiday, training day or unexpected closure when needed.' : 'The center has not published any closed days.'}</Text>
          </View>
        )}

        {grouped.past.length ? (
          <>
            <Text style={[styles.sectionLabel, styles.pastLabel]}>RECENT HISTORY</Text>
            {grouped.past.map(closure => (
              <ClosureCard key={closure.id} closure={closure} canManage={false} onCancel={cancelClosure} />
            ))}
          </>
        ) : null}
      </ScrollView>

      {canManage ? (
        <AddClosureSheet
          visible={adding}
          daycareId={profile?.daycare_id}
          onClose={() => setAdding(false)}
          onSaved={() => load({ quiet: true })}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  headerCopy: { flex: 1, minWidth: 0 },
  pageTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22 },
  pageSubtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  addButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.primary },
  addButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.md },
  summaryCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: '#EFD9B5', backgroundColor: '#FFFDF8' },
  summaryIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.amberLight },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  summaryBody: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  sectionLabel: { marginTop: spacing.sm, color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.9 },
  pastLabel: { marginTop: spacing.xl },
  closureCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  upcomingCard: { borderColor: '#EFD9B5' },
  dateTile: { width: 50, height: 55, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  dateTileUpcoming: { backgroundColor: colors.amberLight },
  dateDay: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, lineHeight: 22 },
  dateMonth: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10 },
  amberText: { color: colors.amber },
  closureCopy: { flex: 1, minWidth: 0 },
  closureReason: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  closureDate: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  familyMessage: { marginTop: 6, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  noChargeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.successLight },
  noChargeText: { color: colors.success, fontFamily: fonts.bold, fontSize: 9.5 },
  familyBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.primarySoft },
  familyBadgeText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 9.5 },
  cancelIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: colors.dangerLight },
  emptyCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  emptyBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, textAlign: 'center' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: '#E9BFC0', backgroundColor: colors.dangerLight },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12.5 },
  errorBody: { marginTop: 2, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 10.5 },
  retryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.36)' },
  sheetDismiss: { flex: 1 },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.bg },
  sheetContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 40 },
  sheetGrabber: { width: 44, height: 5, alignSelf: 'center', marginBottom: spacing.lg, borderRadius: radius.full, backgroundColor: colors.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  sheetSubtitle: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  dateFields: { flexDirection: 'row', gap: spacing.sm },
  dateField: { flex: 1, minWidth: 0 },
  inputLabel: { marginBottom: spacing.xs, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  messageInput: { minHeight: 92, marginBottom: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlignVertical: 'top' },
  publishNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.successLight },
  publishNoteText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  formError: { marginTop: spacing.sm, color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 16 },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  secondaryButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryButtonText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
  publishButton: { flex: 1, marginTop: 0 },
});
