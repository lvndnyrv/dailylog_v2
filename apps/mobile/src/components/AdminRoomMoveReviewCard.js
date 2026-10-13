import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../theme';

export default function AdminRoomMoveReviewCard({ planId, daycareId, onClose }) {
  const isFocused = useIsFocused();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setPlan(null);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.from('room_transition_plans')
        .select('id, move_on, status, review_issue, child:children(first_name, last_name), from_room:classrooms!room_transition_plans_from_classroom_id_fkey(name), to_room:classrooms!room_transition_plans_to_classroom_id_fkey(name)')
        .eq('id', planId).eq('daycare_id', daycareId).maybeSingle();
      if (request !== latestRequest.current) return;
      setPlan(data || null);
      setError(queryError);
    } catch (loadError) {
      if (request === latestRequest.current) setError(loadError);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [planId, daycareId]);

  useEffect(() => {
    if (isFocused) load();
    return () => { latestRequest.current += 1; };
  }, [isFocused, load]);

  const childName = [plan?.child?.first_name, plan?.child?.last_name].filter(Boolean).join(' ');
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>ROOM MOVE REVIEW</Text>
    {loading ? <ActivityIndicator color={colors.primary} /> : error ? (
      <><Text style={styles.body}>Move details could not load.</Text>
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry room move review"><Text style={styles.link}>Try again</Text></TouchableOpacity></>
    ) : !plan ? (
      <Text style={styles.body}>This move is no longer available in your center.</Text>
    ) : <>
      <Text style={styles.title}>{childName || 'Child'} · {plan.from_room?.name || 'Room'} → {plan.to_room?.name || 'Room'}</Text>
      <Text style={styles.body}>Planned for {plan.move_on} · {plan.status}</Text>
      <Text style={styles.body}>{plan.review_issue || 'The saved move has no current review warning. Recheck its plan before making changes.'}</Text>
      <Text style={styles.note}>To change the date or destination, open Rooms & ratios → Room transitions in the admin web app. No move or staffing change was made here.</Text>
    </>}
    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close room move review">
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
});
