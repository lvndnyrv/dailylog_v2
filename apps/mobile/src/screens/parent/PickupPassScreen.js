import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import QRCode from 'qrcode';

import { useAuth } from '../../hooks/useAuth';
import { useParentFamily } from '../../hooks/useParentFamily';
import {
  createMobilePickupPass,
  getParentPickupAttendance,
  getParentPickupOptions,
} from '../../hooks/usePickupVerification';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function QrMatrix({ value, size = 244 }) {
  const matrix = useMemo(() => {
    if (!value) return null;
    try {
      return QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;
    } catch (_error) {
      return null;
    }
  }, [value]);

  if (!matrix) return <ActivityIndicator color={colors.primary} />;

  return (
    <View
      style={[styles.qrQuietZone, { width: size, height: size }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Short-lived pickup QR code"
    >
      <View
        style={styles.qrGrid}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: matrix.size }, (_, row) => (
          <View key={row} style={styles.qrRow}>
            {Array.from({ length: matrix.size }, (_, column) => (
              <View
                key={column}
                style={[
                  styles.qrCell,
                  { backgroundColor: matrix.get(row, column) ? '#0D1F38' : '#FFFFFF' },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function formatCountdown(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export default function PickupPassScreen({ navigation, route }) {
  const { profile } = useAuth();
  const family = useParentFamily();
  const routeChildId = route.params?.childId || route.params?.child?.id;
  const child = route.params?.child
    || family.children.find((candidate) => candidate.id === routeChildId)
    || family.selectedChild
    || null;
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pass, setPass] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const autoRefreshPass = useRef(null);

  const generate = useCallback(async (presenter, { quiet = false } = {}) => {
    if (!child?.id || !presenter) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const attendanceRecord = await getParentPickupAttendance(child.id);
      setAttendance(attendanceRecord);
      if (!attendanceRecord?.checked_in_at) {
        setPass(null);
        throw new Error(`${child.first_name} is not checked in today. A pickup pass will be available after arrival.`);
      }
      if (attendanceRecord.checked_out_at) {
        setPass(null);
        setRemaining(0);
        return;
      }
      const nextPass = await createMobilePickupPass(child.id, presenter);
      setPass(nextPass);
      setRemaining(Math.max(0, Math.ceil((new Date(nextPass.expires_at).getTime() - Date.now()) / 1000)));
      autoRefreshPass.current = null;
    } catch (passError) {
      setError(passError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [child?.first_name, child?.id]);

  useFocusEffect(useCallback(() => {
    let current = true;
    async function start() {
      if (!child?.id) {
        setError('Choose a child before opening a pickup pass.');
        setLoading(false);
        return;
      }
      try {
        const rows = await getParentPickupOptions(child.id, false);
        if (!current) return;
        const active = rows.filter((row) => row.is_active);
        setOptions(active);
        const preferred = active.find((row) => row.source_id === profile?.id)
          || active.find((row) => row.is_primary)
          || active[0];
        setSelected(preferred || null);
        if (preferred) await generate(preferred);
        else {
          setError('No authorized pickup person is available.');
          setLoading(false);
        }
      } catch (loadError) {
        if (current) {
          setError(loadError.message);
          setLoading(false);
        }
      }
    }
    start();
    return () => { current = false; };
  }, [child?.id, generate, profile?.id]));

  useEffect(() => {
    if (!child?.id) return undefined;
    const channel = supabase
      .channel(`parent-pickup-attendance:${child.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'attendance_records',
        filter: `child_id=eq.${child.id}`,
      }, async () => {
        try {
          const attendanceRecord = await getParentPickupAttendance(child.id);
          setAttendance(attendanceRecord);
          if (attendanceRecord?.checked_out_at) {
            setPass(null);
            setRemaining(0);
            setError(null);
          }
        } catch (_error) {
          // The visible pass remains usable until its server-enforced expiry.
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [child?.id]);

  useEffect(() => {
    if (!pass?.expires_at) return undefined;
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((new Date(pass.expires_at).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [pass?.expires_at]);

  useEffect(() => {
    if (!pass || !selected || remaining > 10 || autoRefreshPass.current === pass.pass_id) return;
    autoRefreshPass.current = pass.pass_id;
    generate(selected, { quiet: true });
  }, [generate, pass, remaining, selected]);

  async function choosePresenter(option) {
    if (option.source_type === selected?.source_type && option.source_id === selected?.source_id) return;
    setSelected(option);
    await generate(option);
  }

  const checkoutTime = attendance?.checked_out_at
    ? format(new Date(attendance.checked_out_at), 'h:mm a')
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Family pickup pass</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.navigate('AuthorizedPickups', { child })}
          accessibilityLabel="Manage authorized pickups"
        >
          <Ionicons name="people-outline" size={21} color={colors.white} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.childBadge}>
          <View style={styles.childAvatar}>
            <Text style={styles.childAvatarText}>{child?.first_name?.[0] || '?'}</Text>
          </View>
          <View style={styles.childCopy}>
            <Text style={styles.childName}>{child?.first_name} {child?.last_name}</Text>
            <Text style={styles.childRoom}>
              {pass?.room_name || child?.classroom?.name || 'Classroom'} · {pass?.center_name || 'DailyLog center'}
            </Text>
          </View>
        </View>

        {options.length > 1 && (
          <View style={styles.presenterSection}>
            <Text style={styles.presenterLabel}>Who is picking up?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presenterList}>
              {options.map((option) => {
                const active = option.source_type === selected?.source_type
                  && option.source_id === selected?.source_id;
                return (
                  <TouchableOpacity
                    key={`${option.source_type}:${option.source_id}`}
                    style={[styles.presenterChip, active && styles.presenterChipActive]}
                    onPress={() => choosePresenter(option)}
                    disabled={loading || refreshing}
                  >
                    <Text style={[styles.presenterChipName, active && styles.presenterChipNameActive]}>
                      {option.source_id === profile?.id ? 'Me' : option.full_name.split(' ')[0]}
                    </Text>
                    <Text style={[styles.presenterChipRole, active && styles.presenterChipRoleActive]}>
                      {option.relationship || 'Authorized'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.passCard}>
          {checkoutTime ? (
            <View style={styles.pickupComplete}>
              <View style={styles.pickupCompleteIcon}>
                <Ionicons name="checkmark" size={38} color={colors.white} />
              </View>
              <Text style={styles.pickupCompleteEyebrow}>PICKUP COMPLETE</Text>
              <Text style={styles.pickupCompleteTitle}>{child?.first_name} was checked out</Text>
              <Text style={styles.pickupCompleteText}>
                Released at {checkoutTime}{attendance?.picked_up_by ? ` to ${attendance.picked_up_by}` : ''}. The signed attendance record is available on Today.
              </Text>
              <TouchableOpacity style={styles.pickupCompleteButton} onPress={() => navigation.goBack()}>
                <Text style={styles.pickupCompleteButtonText}>Back to today</Text>
              </TouchableOpacity>
            </View>
          ) : loading && !pass ? (
            <View style={styles.loadingPass}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Creating a secure pass…</Text>
            </View>
          ) : error && !pass ? (
            <View style={styles.loadingPass}>
              <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
              <Text style={styles.passError}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => selected && generate(selected)}
              >
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.passTitle}>Show this at the door</Text>
              <Text style={styles.passSubtitle}>An educator scans it before releasing {child?.first_name}.</Text>
              <View style={styles.qrWrap}>
                <QrMatrix value={pass?.qr_payload} />
                {refreshing && (
                  <View style={styles.qrRefreshing}>
                    <ActivityIndicator size="large" color={colors.primary} />
                  </View>
                )}
              </View>
              <View style={styles.timerRow}>
                <Ionicons name="time-outline" size={17} color={remaining <= 20 ? colors.amber : colors.textMuted} />
                <Text style={[styles.timerText, remaining <= 20 && styles.timerWarning]}>
                  Refreshes in {formatCountdown(remaining)}
                </Text>
              </View>
              <Text style={styles.presenterName}>{pass?.presenter_name}</Text>
              <Text style={styles.presenterRelationship}>{pass?.relationship || 'Authorized pickup'}</Text>
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>Can’t scan? Tell the educator this code</Text>
                <Text style={styles.manualCode}>{pass?.manual_code || '------'}</Text>
              </View>
              {error && <Text style={styles.inlineError}>{error}</Text>}
            </>
          )}
        </View>

        <TouchableOpacity
          style={styles.manageButton}
          onPress={() => navigation.navigate('AuthorizedPickups', { child })}
        >
          <Ionicons name="people-outline" size={19} color={colors.white} />
          <Text style={styles.manageButtonText}>Manage authorized pickups</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.securityNote}>
          <Ionicons name="shield-checkmark-outline" size={17} color="#AFC2D9" />
          <Text style={styles.securityText}>
            Only center-approved pickup people appear here. The code expires automatically, works once, and cannot check out a different child.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#132B4A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  headerButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: { color: colors.white, fontSize: 18, fontFamily: fonts.black },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  childBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  childAvatar: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center',
    borderRadius: 23, backgroundColor: colors.primary,
  },
  childAvatarText: { color: colors.white, fontSize: 17, fontFamily: fonts.black },
  childCopy: { flex: 1, minWidth: 0 },
  childName: { color: colors.white, fontSize: 16, fontFamily: fonts.black },
  childRoom: { marginTop: 2, color: '#AFC2D9', fontSize: 12, fontFamily: fonts.regular },
  presenterSection: { marginBottom: spacing.lg },
  presenterLabel: { marginBottom: spacing.sm, color: '#C8D5E5', fontSize: 11.5, fontFamily: fonts.bold },
  presenterList: { gap: spacing.sm },
  presenterChip: {
    minWidth: 104, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  presenterChipActive: { borderColor: '#88B9F0', backgroundColor: colors.primary },
  presenterChipName: { color: '#D6E0EC', fontSize: 12.5, fontFamily: fonts.bold },
  presenterChipNameActive: { color: colors.white },
  presenterChipRole: { marginTop: 1, color: '#91A8C1', fontSize: 10.5, fontFamily: fonts.regular },
  presenterChipRoleActive: { color: '#DBEBFC' },
  passCard: {
    alignItems: 'center', padding: spacing.lg, borderRadius: 26, backgroundColor: colors.white,
  },
  loadingPass: { minHeight: 430, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  pickupComplete: { minHeight: 430, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  pickupCompleteIcon: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.success,
  },
  pickupCompleteEyebrow: {
    marginTop: spacing.lg, color: colors.success, fontSize: 10.5,
    letterSpacing: 1.4, fontFamily: fonts.bold,
  },
  pickupCompleteTitle: {
    marginTop: spacing.sm, color: colors.textPrimary, textAlign: 'center',
    fontSize: 22, fontFamily: fonts.black,
  },
  pickupCompleteText: {
    marginTop: spacing.sm, color: colors.textMuted, textAlign: 'center',
    fontSize: 13, lineHeight: 19, fontFamily: fonts.regular,
  },
  pickupCompleteButton: {
    minHeight: 48, marginTop: spacing.xl, alignSelf: 'stretch',
    alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  pickupCompleteButtonText: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  loadingText: { marginTop: spacing.md, color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  passError: {
    marginTop: spacing.md, color: colors.danger, textAlign: 'center',
    fontSize: 13, lineHeight: 19, fontFamily: fonts.bold,
  },
  retryButton: {
    marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  retryText: { color: colors.white, fontSize: 13, fontFamily: fonts.bold },
  passTitle: { color: colors.textPrimary, fontSize: 20, fontFamily: fonts.black },
  passSubtitle: {
    marginTop: spacing.xs, color: colors.textMuted, textAlign: 'center',
    fontSize: 12.5, fontFamily: fonts.regular,
  },
  qrWrap: { marginTop: spacing.lg, position: 'relative' },
  qrQuietZone: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.white },
  qrGrid: { flex: 1 },
  qrRow: { flex: 1, flexDirection: 'row' },
  qrCell: { flex: 1, aspectRatio: 1 },
  qrRefreshing: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.84)',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  timerText: { color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.bold },
  timerWarning: { color: colors.amber },
  presenterName: { marginTop: spacing.md, color: colors.textPrimary, fontSize: 16, fontFamily: fonts.black },
  presenterRelationship: { marginTop: 1, color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  codeCard: {
    alignSelf: 'stretch', alignItems: 'center', marginTop: spacing.lg, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.primarySoft,
  },
  codeLabel: { color: colors.textMuted, fontSize: 10.5, fontFamily: fonts.regular },
  manualCode: {
    marginTop: spacing.xs, color: colors.textPrimary, fontSize: 24,
    letterSpacing: 7, fontFamily: fonts.black,
  },
  inlineError: { marginTop: spacing.sm, color: colors.danger, fontSize: 11.5, fontFamily: fonts.bold },
  manageButton: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.lg, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)', borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  manageButtonText: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  securityNote: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  securityText: { flex: 1, color: '#AFC2D9', fontSize: 11, lineHeight: 16, fontFamily: fonts.regular },
});
