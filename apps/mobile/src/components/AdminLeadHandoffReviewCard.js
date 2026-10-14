import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { isAdminRole } from '@dailylog/shared';

import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius, spacing } from '../theme';

const roomFields = 'id, name, age_group, min_age_months, max_age_months, capacity, ratio_children_per_educator, opens_on, nap_start, nap_end, lead_educator_id, updated_at';

export default function AdminLeadHandoffReviewCard({ roomId, daycareId, onClose, onTransferred }) {
  const { profile } = useAuth();
  const isFocused = useIsFocused();
  const latestRequest = useRef(0);
  const [room, setRoom] = useState(null);
  const [lead, setLead] = useState(null);
  const [staffMember, setStaffMember] = useState(null);
  const [homeRoom, setHomeRoom] = useState(null);
  const [centerToday, setCenterToday] = useState(null);
  const [canTransfer, setCanTransfer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError('');
    setCanTransfer(false);
    try {
      const [roomResult, todayResult, roomPermission, staffPermission] = await Promise.all([
        supabase.from('classrooms').select(roomFields)
          .eq('id', roomId).eq('daycare_id', daycareId).is('archived_at', null).maybeSingle(),
        supabase.rpc('center_today'),
        supabase.rpc('has_permission', { p_area: 'rooms', p_action: 'edit' }),
        supabase.rpc('has_permission', { p_area: 'staff', p_action: 'edit' }),
      ]);
      const firstError = roomResult.error || todayResult.error || roomPermission.error || staffPermission.error;
      if (firstError) throw firstError;
      const nextRoom = roomResult.data || null;
      let nextLead = null;
      let nextStaffMember = null;
      let nextHomeRoom = null;
      if (nextRoom?.lead_educator_id) {
        const leadResult = await supabase.from('profiles')
          .select('id, full_name, role, classroom_id, archived_at')
          .eq('id', nextRoom.lead_educator_id).eq('daycare_id', daycareId).maybeSingle();
        if (leadResult.error) throw leadResult.error;
        nextLead = leadResult.data || null;
        if (nextLead) {
          const staffResult = await supabase.from('staff_members')
            .select('status, archived_at, ended_on')
            .eq('profile_id', nextLead.id).eq('daycare_id', daycareId).maybeSingle();
          if (staffResult.error) throw staffResult.error;
          nextStaffMember = staffResult.data || null;
        }
        if (nextLead?.classroom_id && nextLead.classroom_id !== roomId) {
          const homeResult = await supabase.from('classrooms').select('name')
            .eq('id', nextLead.classroom_id).eq('daycare_id', daycareId).maybeSingle();
          if (homeResult.error) throw homeResult.error;
          nextHomeRoom = homeResult.data?.name || null;
        }
      }
      if (request !== latestRequest.current) return;
      setRoom(nextRoom);
      setLead(nextLead);
      setStaffMember(nextStaffMember);
      setHomeRoom(nextHomeRoom);
      setCenterToday(todayResult.data || null);
      setCanTransfer(isAdminRole(profile?.role) && roomPermission.data === true && staffPermission.data === true);
      return { room: nextRoom, lead: nextLead };
    } catch (loadError) {
      if (request === latestRequest.current) setError(loadError.message || 'Could not load this review.');
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [roomId, daycareId, profile?.role]);

  useEffect(() => {
    if (isFocused) load();
    return () => { latestRequest.current += 1; };
  }, [isFocused, load]);

  const alreadyAssigned = Boolean(room && lead && lead.classroom_id === room.id);
  const futureOpening = Boolean(room?.opens_on && centerToday && room.opens_on > centerToday);
  const completeSettings = Boolean(room?.name && room?.age_group && room?.min_age_months != null
    && room?.max_age_months != null && room?.capacity && room?.ratio_children_per_educator);
  const eligibleLead = Boolean(lead && lead.role === 'educator' && !lead.archived_at
    && staffMember?.status === 'active' && !staffMember.archived_at
    && (!staffMember.ended_on || !centerToday || staffMember.ended_on > centerToday));
  const actionable = Boolean(canTransfer && eligibleLead && room?.opens_on && centerToday
    && !futureOpening && !alreadyAssigned && completeSettings && !loading && !error);

  async function transfer() {
    if (!actionable || saving) return;
    setSaving(true);
    setSaveNotice('');
    try {
      const settings = {
        name: room.name,
        age_group: room.age_group,
        min_age_months: String(room.min_age_months),
        max_age_months: String(room.max_age_months),
        capacity: String(room.capacity),
        ratio: String(room.ratio_children_per_educator),
        opens_on: room.opens_on || '',
        nap_start: room.nap_start || '',
        nap_end: room.nap_end || '',
        lead_educator_id: room.lead_educator_id || '',
      };
      const { data, error: transferError } = await supabase.rpc('save_room_settings_with_lead_transfer', {
        p_room_id: room.id,
        p_settings: settings,
        p_expected_updated_at: room.updated_at,
      });
      if (transferError) throw transferError;
      if (data !== room.id) throw new Error('The transfer did not confirm this room.');
      await load();
      onTransferred?.();
    } catch (transferError) {
      const latest = await load();
      if (latest?.lead?.classroom_id === room.id) {
        setSaveNotice('The home-room transfer is confirmed.');
        onTransferred?.();
      } else {
        setSaveNotice(`${transferError.message || 'Could not confirm the transfer.'} Review the latest room details before trying again.`);
      }
    } finally {
      setSaving(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.eyebrow}>ROOM LEAD HANDOFF</Text>
    {loading ? <ActivityIndicator color={colors.primary} /> : error ? (
      <>
        <Text style={styles.body}>This handoff review could not load. {error}</Text>
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry room lead review">
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity>
      </>
    ) : !room ? (
      <Text style={styles.body}>This room is no longer available in your center.</Text>
    ) : <>
      <Text style={styles.title}>{room.name}</Text>
      {!lead || !eligibleLead ? <Text style={styles.body}>The designated lead is no longer an active educator here. Choose an eligible lead in admin web Rooms & ratios.</Text>
        : alreadyAssigned ? <Text style={styles.body}>{lead.full_name} already has this room as their permanent home room. No transfer is needed.</Text>
          : <Text style={styles.body}>{lead.full_name} leads this room but currently belongs to {homeRoom || 'the floater pool'}.</Text>}
      {room.opens_on ? <Text style={styles.detail}>Room opens {room.opens_on} · Center today {centerToday || 'unavailable'}</Text> : null}
      {!room.opens_on ? <Text style={styles.note}>This room no longer has an opening date. Review its lead plan in admin web Rooms & ratios.</Text> : null}
      {room.opens_on && !centerToday ? <Text style={styles.note}>The center date is unavailable. Refresh this review before transferring anyone.</Text> : null}
      {futureOpening ? <Text style={styles.note}>Keep current room access until opening day. The transfer can be reviewed then.</Text> : null}
      {!completeSettings ? <Text style={styles.note}>Complete this room’s age band, capacity and ratio before moving its lead.</Text> : null}
      {!canTransfer && !alreadyAssigned ? <Text style={styles.note}>An administrator needs both room-edit and staff-edit access to complete this handoff.</Text> : null}
      {actionable ? <>
        <Text style={styles.note}>This changes permanent room access now. Review coverage in the former room and update published shifts and regular schedules first; the server will reject unresolved conflicts.</Text>
        <TouchableOpacity style={styles.action} disabled={saving} accessibilityRole="button"
          accessibilityLabel={`Move ${lead.full_name} home room to ${room.name}`}
          onPress={() => Alert.alert('Move the lead’s home room?', `${lead.full_name} will permanently move from ${homeRoom || 'the floater pool'} to ${room.name}. Confirm that their current room coverage and schedule have been reviewed.`, [
            { text: 'Keep current room', style: 'cancel' },
            { text: 'Move home room', onPress: transfer },
          ])}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.actionText}>Move home room here</Text>}
        </TouchableOpacity>
      </> : null}
      {saveNotice ? <Text style={styles.notice}>{saveNotice}</Text> : null}
    </>}
    <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close room lead review">
      <Text style={styles.link}>Close review</Text>
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.amber,
    borderRadius: radius.xl, backgroundColor: colors.surface },
  eyebrow: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, color: colors.amber },
  title: { fontFamily: fonts.black, fontSize: 17, color: colors.textPrimary },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
  detail: { fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.textMuted },
  notice: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.coral },
  link: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary, paddingVertical: spacing.sm },
  action: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.primary },
  actionText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
