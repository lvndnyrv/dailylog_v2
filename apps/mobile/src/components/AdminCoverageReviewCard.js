import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../theme';

function when(value, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminCoverageReviewCard({ assignmentId, daycareId, onClose }) {
  const isFocused = useIsFocused();
  const [assignment, setAssignment] = useState(null);
  const [timezone, setTimezone] = useState('UTC');
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setAssignment(null);
    setCanEdit(false);
    setError(null);
    try {
      const [record, center, permission] = await Promise.all([
        supabase.from('room_coverage_assignments')
          .select('id, starts_at, ends_at, status, review_issue, room:classrooms(name), staff:staff_members(profile:profiles(full_name))')
          .eq('id', assignmentId).eq('daycare_id', daycareId).maybeSingle(),
        supabase.from('daycares').select('timezone').eq('id', daycareId).maybeSingle(),
        supabase.rpc('has_permission', { p_area: 'rooms', p_action: 'edit' }),
      ]);
      if (request !== latestRequest.current) return;
      setAssignment(record.data || null);
      setTimezone(center.data?.timezone || 'UTC');
      setCanEdit(permission.data === true);
      setError(record.error || center.error || permission.error || null);
    } catch (loadError) {
      if (request === latestRequest.current) setError(loadError);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [assignmentId, daycareId]);

  useEffect(() => {
    if (isFocused) load();
    return () => { latestRequest.current += 1; };
  }, [isFocused, load]);

  async function cancelCoverage() {
    setCancelling(true);
    try {
      const { error: cancelError } = await supabase.rpc('cancel_planned_room_coverage', {
        p_assignment: assignmentId,
      });
      if (cancelError) throw cancelError;
      await load();
    } catch (cancelError) {
      Alert.alert('Could not cancel coverage', cancelError.message || 'Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.eyebrow}>ROOM COVERAGE REVIEW</Text>
    {loading ? <ActivityIndicator color={colors.primary} /> : error ? (
      <><Text style={styles.body}>Coverage details could not load.</Text>
        <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={styles.link}>Try again</Text></TouchableOpacity></>
    ) : !assignment ? (
      <Text style={styles.body}>This assignment is no longer available in your center.</Text>
    ) : <>
      <Text style={styles.title}>{assignment.room?.name || 'Room'} · {assignment.staff?.profile?.full_name || 'Educator'}</Text>
      <Text style={styles.body}>{when(assignment.starts_at, timezone)}–{when(assignment.ends_at, timezone)} · {assignment.status}</Text>
      <Text style={styles.body}>{assignment.review_issue || 'No current review warning. Check the live room plan before making changes.'}</Text>
      {canEdit && ['assigned', 'accepted', 'declined'].includes(assignment.status) && new Date(assignment.ends_at) > new Date() && (
        <TouchableOpacity
          style={styles.cancel}
          disabled={cancelling}
          accessibilityRole="button"
          onPress={() => Alert.alert('Cancel this coverage?', 'The educator will be notified. Arrange replacement coverage from the admin web planner if needed.', [
            { text: 'Keep coverage', style: 'cancel' },
            { text: 'Cancel coverage', style: 'destructive', onPress: cancelCoverage },
          ])}
        >
          <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel coverage'}</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.note}>Changes to the coverage plan and replacement staffing are available in admin web Rooms & ratios.</Text>
    </>}
    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close coverage review">
      <Text style={styles.link}>Close review</Text>
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  eyebrow: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, color: colors.textFaint },
  title: { fontFamily: fonts.black, fontSize: 16, color: colors.textPrimary },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.textFaint },
  link: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary, paddingVertical: spacing.sm },
  cancel: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: '#FFF5F2' },
  cancelText: { fontFamily: fonts.bold, fontSize: 13, color: colors.coral },
});
