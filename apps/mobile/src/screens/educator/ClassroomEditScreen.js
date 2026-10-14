import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import { useClassroom } from '../../hooks/useClassroom';
import { useRoomEditAccess } from '../../hooks/useRoomEditAccess';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';
import { Button, Input } from '../../components/ui';

const fields = ['name', 'age_group', 'min_age_months', 'max_age_months', 'capacity', 'ratio'];

function initialValues(room) {
  return {
    name: room.name || '', age_group: room.age_group || '',
    min_age_months: room.min_age_months == null ? '' : String(room.min_age_months),
    max_age_months: room.max_age_months == null ? '' : String(room.max_age_months),
    capacity: room.capacity == null ? '' : String(room.capacity),
    ratio: room.ratio_children_per_educator == null ? '' : String(room.ratio_children_per_educator),
  };
}

function validate(values) {
  const errors = {};
  if (!values.name.trim() || values.name.trim().length > 100) errors.name = 'Enter a room name (up to 100 characters).';
  if (!values.age_group.trim() || values.age_group.trim().length > 100) errors.age_group = 'Enter an age-band name (up to 100 characters).';
  for (const [key, min, max] of [
    ['min_age_months', 0, 215], ['max_age_months', 1, 216], ['capacity', 1, 9999], ['ratio', 1, 999],
  ]) {
    if (!/^\d+$/.test(values[key]) || Number(values[key]) < min || Number(values[key]) > max) {
      errors[key] = `Enter a whole number from ${min} to ${max}.`;
    }
  }
  if (!errors.min_age_months && !errors.max_age_months &&
      Number(values.max_age_months) <= Number(values.min_age_months)) {
    errors.max_age_months = 'Oldest age must be after youngest age.';
  }
  return errors;
}

export default function ClassroomEditScreen({ route, navigation }) {
  const roomId = route.params?.classroom?.id;
  const { reload: reloadClassrooms } = useClassroom();
  const { canEditRooms, roomEditAccessReady, roomEditAccessError, refreshRoomEditAccess } = useRoomEditAccess();
  const [room, setRoom] = useState(null);
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadRoom = useCallback(async () => {
    if (!roomId) {
      setLoadError('This classroom is unavailable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from('classrooms')
      .select('id, name, age_group, min_age_months, max_age_months, capacity, ratio_children_per_educator, opens_on, nap_start, nap_end, lead_educator_id, updated_at')
      .eq('id', roomId).is('archived_at', null).maybeSingle();
    if (error || !data) {
      setRoom(null);
      setValues(null);
      setLoadError(error?.message || 'This classroom is no longer available.');
    } else {
      setRoom(data);
      setValues(initialValues(data));
      setErrors({});
    }
    setLoading(false);
  }, [roomId]);

  useEffect(() => { loadRoom(); }, [loadRoom]);

  function change(key, value) {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: '' }));
  }

  const hasChanges = Boolean(room && values && fields.some(key =>
    values[key].trim() !== initialValues(room)[key]));

  async function handleSave() {
    if (!room || !values || saving || !canEditRooms) return;
    const nextErrors = validate(values);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      const settings = Object.fromEntries(fields.map(key => [key, values[key].trim()]));
      // The atomic RPC saves the complete record; preserve settings this editor does not expose.
      settings.opens_on = room.opens_on || '';
      settings.nap_start = room.nap_start || '';
      settings.nap_end = room.nap_end || '';
      settings.lead_educator_id = room.lead_educator_id || '';
      const { data, error } = await supabase.rpc('save_room_settings', {
        p_room_id: room.id, p_settings: settings, p_expected_updated_at: room.updated_at,
      });
      if (error) throw error;
      if (data !== room.id) throw new Error('The save did not confirm this classroom.');
      await reloadClassrooms?.();
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not confirm room changes', `${error.message}\n\nReload this room before retrying. No second save was sent.`);
      await loadRoom();
    } finally {
      setSaving(false);
    }
  }

  function handleReload() {
    if (!hasChanges) {
      loadRoom();
      return;
    }
    Alert.alert('Discard draft changes?', 'Reloading will replace the values you entered on this screen.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Reload room', onPress: loadRoom },
    ]);
  }

  return (
    <KeyboardAwareScrollView style={styles.container} contentContainerStyle={styles.content}
      enableOnAndroid extraScrollHeight={20} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back to classroom">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CENTER OPERATIONS</Text>
          <Text style={styles.title}>Edit classroom</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{room?.name || route.params?.classroom?.name || 'Classroom settings'}</Text>
        </View>
      </View>

      {loading || !roomEditAccessReady ? <ActivityIndicator style={styles.loading} color={colors.primary} size="large" /> : !canEditRooms ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Room editing unavailable</Text>
          <Text style={styles.note}>{roomEditAccessError
            ? 'Could not verify your room-edit access. Try again when connected.'
            : 'Your account can view classrooms, but an owner must grant room-edit access to change them.'}</Text>
          {roomEditAccessError ? <Button label="Check access again" onPress={refreshRoomEditAccess} style={styles.action} /> : null}
        </View>
      ) : loadError ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Could not load this room</Text>
          <Text style={styles.note}>{loadError}</Text>
          <Button label="Try again" onPress={loadRoom} style={styles.action} />
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Room details</Text>
            <Text style={styles.note}>Complete the age band, capacity and room ratio before saving. The ratio is entered by your center; it is not verified against licensing rules.</Text>
            <Input label="Classroom name" required value={values.name} onChangeText={value => change('name', value)}
              placeholder="e.g. Toddler" error={errors.name} maxLength={100} />
            <Input label="Age band" required value={values.age_group} onChangeText={value => change('age_group', value)}
              placeholder="e.g. 18 months–3 years" error={errors.age_group} maxLength={100} />
            <Input label="Youngest (months)" required value={values.min_age_months}
              onChangeText={value => change('min_age_months', value)} keyboardType="number-pad" placeholder="18" error={errors.min_age_months} />
            <Input label="Oldest (months)" required value={values.max_age_months}
              onChangeText={value => change('max_age_months', value)} keyboardType="number-pad" placeholder="36" error={errors.max_age_months} />
            <Input label="Capacity" required value={values.capacity}
              onChangeText={value => change('capacity', value)} keyboardType="number-pad" placeholder="12" error={errors.capacity} />
            <Input label="Children per educator" required value={values.ratio}
              onChangeText={value => change('ratio', value)} keyboardType="number-pad" placeholder="4" error={errors.ratio} />
            <Button label="Save room settings" onPress={handleSave} loading={saving}
              disabled={!hasChanges || saving} style={[styles.action, !hasChanges && styles.disabled]} />
            <TouchableOpacity onPress={handleReload} disabled={saving} accessibilityRole="button" style={styles.reload}>
              <Text style={styles.reloadText}>Reload latest settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.infoText}>Opening date, nap schedule and room lead stay unchanged here. Edit those in admin web Rooms & ratios. Permanent room deletion is unavailable on mobile because it can erase historical records.</Text>
          </View>
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  headerCopy: { flex: 1 },
  eyebrow: { fontFamily: fonts.bold, color: colors.textFaint, fontSize: 10, letterSpacing: 1.1 },
  title: { fontFamily: fonts.black, color: colors.textPrimary, fontSize: 24 },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  loading: { marginTop: spacing.xl * 2 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bold, color: colors.textPrimary, fontSize: 17 },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  action: { marginTop: spacing.md },
  disabled: { opacity: 0.45 },
  reload: { alignSelf: 'center', padding: spacing.sm },
  reloadText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  infoCard: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
});
