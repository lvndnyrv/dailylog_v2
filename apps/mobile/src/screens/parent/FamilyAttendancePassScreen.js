import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FamilyScreenHeader from './FamilyScreenHeader';

import { useAuth } from '../../hooks/useAuth';
import { useParentFamily } from '../../hooks/useParentFamily';
import { getParentPickupOptions } from '../../hooks/usePickupVerification';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';
import { QrMatrix } from './PickupPassScreen';

function remainingSeconds(expiresAt) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export default function FamilyAttendancePassScreen({ navigation, route }) {
  const { profile } = useAuth();
  const family = useParentFamily();
  const routeChildId = route.params?.childId || route.params?.child?.id;
  const child = route.params?.child
    || family.children.find(candidate => candidate.id === routeChildId)
    || family.selectedChild;
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pass, setPass] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const latest = useRef(0);
  const refreshing = useRef(false);

  const generate = useCallback(async (option) => {
    if (!child?.id || !option) return;
    const request = ++latest.current;
    refreshing.current = true;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_family_attendance_pass', {
        p_child_id: child.id,
        p_pickup_id: option.source_type === 'pickup' ? option.source_id : null,
      });
      if (rpcError) throw rpcError;
      if (request !== latest.current) return;
      const row = data?.[0];
      if (!row) throw new Error('The attendance pass could not be created.');
      setPass(row);
      setRemaining(remainingSeconds(row.expires_at));
    } catch (cause) {
      if (request === latest.current) {
        setPass(null);
        setError(cause.message || 'The attendance pass is unavailable.');
      }
    } finally {
      if (request === latest.current) {
        setLoading(false);
        refreshing.current = false;
      }
    }
  }, [child?.id]);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      if (!child?.id || !profile?.id) return;
      try {
        const all = await getParentPickupOptions(child.id, false);
        if (!active) return;
        const allowed = all.filter(person => person.is_active && (
          person.source_type === 'pickup' || person.source_id === profile.id
        ));
        setOptions(allowed);
        const preferred = allowed.find(person => person.source_id === profile.id) || allowed[0];
        if (preferred) {
          setSelected(preferred);
          await generate(preferred);
        } else {
          setLoading(false);
          setError('No approved adult is available for this child.');
        }
      } catch (cause) {
        if (active) {
          setLoading(false);
          setError(cause.message || 'Could not load approved adults.');
        }
      }
    }
    load();
    return () => { active = false; latest.current += 1; };
  }, [child?.id, profile?.id, generate]));

  useEffect(() => {
    if (!pass?.expires_at) return undefined;
    const timer = setInterval(() => setRemaining(remainingSeconds(pass.expires_at)), 1000);
    return () => clearInterval(timer);
  }, [pass?.expires_at]);

  useEffect(() => {
    if (!child?.id) return undefined;
    const channel = supabase.channel(`family-attendance-pass:${child.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendance_records',
        filter: `child_id=eq.${child.id}`,
      }, () => {
        setPass(null);
        setRemaining(0);
        setError('Attendance updated. Create a fresh pass for the next door visit.');
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [child?.id]);

  useEffect(() => {
    if (pass && selected && remaining <= 15 && !refreshing.current) generate(selected);
  }, [remaining, pass, selected, generate]);

  async function choose(option) {
    if (option.source_type === selected?.source_type && option.source_id === selected?.source_id) return;
    setSelected(option);
    await generate(option);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FamilyScreenHeader navigation={navigation} title="Door pass" subtitle={child?.first_name ? `For ${child.first_name}` : 'For your family'} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.introCard}>
          <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
          <View style={styles.introCopy}>
            <Text style={styles.childName}>{child?.first_name} {child?.last_name}</Text>
            <Text style={styles.muted}>Show this pass at the door to check in or out.</Text>
          </View>
        </View>

        {options.length > 1 && (
          <View style={styles.chooseCard}>
            <Text style={styles.label}>Who is bringing or collecting {child?.first_name}?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
              {options.map(option => {
                const active = option.source_type === selected?.source_type && option.source_id === selected?.source_id;
                return (
                  <TouchableOpacity key={`${option.source_type}:${option.source_id}`}
                    onPress={() => choose(option)} style={[styles.option, active && styles.optionActive]}>
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {option.source_id === profile?.id ? 'Me' : option.full_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.passCard}>
          {loading && !pass ? (
            <View style={styles.placeholder}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Creating a secure pass…</Text></View>
          ) : pass ? (
            <>
              <Text style={styles.passHeading}>Scan at the door</Text>
              <QrMatrix value={pass.qr_payload} accessibilityLabel="Short-lived family attendance QR code" />
              <Text style={styles.presenter}>{pass.presenter_name}</Text>
              <Text style={styles.muted}>For {pass.child_name} · {pass.room_name || 'classroom'}</Text>
              <Text style={styles.countdown}>Refreshes in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</Text>
              {loading && <ActivityIndicator color={colors.primary} />}
            </>
          ) : null}
          {error && <Text style={styles.error}>{error}</Text>}
          {selected && <TouchableOpacity onPress={() => generate(selected)} disabled={loading} style={styles.retry}>
            <Text style={styles.retryText}>{pass ? 'Refresh pass' : 'Create new pass'}</Text>
          </TouchableOpacity>}
        </View>

        <View style={styles.helpCard}>
          <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
          <Text style={styles.helpText}>Each QR works once and expires quickly. The educator’s door tablet must be online. If scanning is unavailable, use your approved 4-digit PIN or ask at the desk. Pickup verification passes are separate.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontFamily: fonts.bold, color: colors.textFaint, letterSpacing: 1.2 },
  title: { fontSize: 26, fontFamily: fonts.bold, color: colors.textPrimary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  introCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  introCopy: { flex: 1 },
  childName: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  muted: { fontSize: 13, fontFamily: fonts.regular, color: colors.textMuted, lineHeight: 19 },
  chooseCard: { gap: spacing.sm },
  label: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  options: { gap: spacing.sm },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.white },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textMuted },
  optionTextActive: { color: colors.primary },
  passCard: { alignItems: 'center', minHeight: 340, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  passHeading: { fontSize: 20, fontFamily: fonts.bold, color: colors.textPrimary },
  presenter: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  countdown: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  error: { fontSize: 13, fontFamily: fonts.regular, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { fontSize: 14, fontFamily: fonts.bold, color: colors.white },
  helpCard: { flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  helpText: { flex: 1, fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted, lineHeight: 18 },
});
