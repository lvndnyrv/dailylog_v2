import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '../../lib/supabase';
import {
  printComplianceInspectionPack,
  shareComplianceInspectionPdf,
} from '../../lib/export';
import { colors, fonts, radius, spacing } from '../../theme';

function dateTime(value, timezone, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return date.toLocaleString('en-CA', {
      timeZone: timezone || 'UTC',
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return date.toLocaleString();
  }
}

function staffComplete(member, today) {
  const required = (member.credentials || []).filter(item => item.required);
  return required.length > 0 && required.every(item => (
    item.completed_on
    && (!item.expires_on || item.expires_on >= today)
    && item.document_id
    && !item.pending_review
  ));
}

function SummaryMetric({ value, label, tone = 'blue' }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tone === 'danger' && styles.metricDanger]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function RegisterSection({ icon, title, detail, rows, empty }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDetail}>{detail}</Text>
        </View>
      </View>
      {!rows.length ? <Text style={styles.empty}>{empty}</Text> : rows.slice(0, 4).map((row, index) => (
        <View key={row.key || `${title}:${index}`} style={[styles.registerRow, index > 0 && styles.rowBorder]}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={styles.rowDetail}>{row.detail}</Text>
          </View>
          {row.status ? <Text style={[styles.rowStatus, row.danger && styles.rowStatusDanger]}>{row.status}</Text> : null}
        </View>
      ))}
      {rows.length > 4 ? <Text style={styles.more}>+ {rows.length - 4} more in the PDF</Text> : null}
    </View>
  );
}

export default function AdminInspectionPackScreen({ navigation }) {
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_compliance_inspection_pack');
    if (loadError) setError(loadError.message || 'The inspection pack could not be loaded.');
    else setPack(data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const summary = useMemo(() => {
    if (!pack) return null;
    const staff = pack.staff || [];
    const completeStaff = staff.filter(member => staffComplete(member, pack.today)).length;
    const unsigned = (pack.incidents || []).filter(incident => !incident.signed_off_at).length;
    const checks = [
      staff.length > 0 && completeStaff === staff.length,
      unsigned === 0,
      (pack.documents || []).some(document => document.category === 'license' && (!document.expires_on || document.expires_on >= pack.today)),
      (pack.documents || []).some(document => document.category === 'insurance' && (!document.expires_on || document.expires_on >= pack.today)),
      (pack.drills || []).some(drill => !drill.voided_at),
    ];
    const ledger = pack.ratio_ledger || {};
    return {
      completeStaff,
      unsigned,
      score: Math.round((checks.filter(Boolean).length / checks.length) * 100),
      ratio: Number(ledger.observed_minutes)
        ? Math.round((Number(ledger.compliant_minutes) / Number(ledger.observed_minutes)) * 100)
        : null,
    };
  }, [pack]);

  async function printPack() {
    if (!pack || busy) return;
    setBusy('print');
    setError('');
    try {
      await printComplianceInspectionPack(pack);
    } catch (printError) {
      if (!/(cancel|PrintIncompleteException|Printing did not complete)/i.test(printError?.message || '')) {
        setError(printError?.message || 'The print preview could not be opened.');
      }
    } finally {
      setBusy('');
    }
  }

  function confirmShare() {
    if (!pack || busy) return;
    Alert.alert(
      'Share a protected copy?',
      'The PDF contains child attendance, staff checklist and incident-register information. Copies shared outside DailyLog are no longer protected by app access controls.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Prepare PDF',
          onPress: async () => {
            setBusy('share');
            setError('');
            try {
              await shareComplianceInspectionPdf(pack);
            } catch (shareError) {
              if (!/cancel/i.test(shareError?.message || '')) {
                setError(shareError?.message || 'The PDF could not be prepared.');
              }
            } finally {
              setBusy('');
            }
          },
        },
      ],
    );
  }

  if (loading && !pack) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const ledger = pack?.ratio_ledger || { observed_minutes: 0, over_minutes: 0, intervals: [] };
  const attendanceRows = (pack?.attendance || []).map(row => ({
    key: row.id,
    title: `${row.room || 'Unassigned'} · ${row.child_name}`,
    detail: `${dateTime(row.checked_in_at, pack.timezone, 'Not checked in')} → ${dateTime(row.checked_out_at, pack.timezone, 'Still present')}`,
    status: row.status,
  }));
  const ratioRows = (ledger.intervals || []).map(row => ({
    key: row.id,
    title: row.room,
    detail: `${dateTime(row.starts_at, pack.timezone)} → ${dateTime(row.ends_at, pack.timezone, 'Current')}`,
    status: Number(row.required_staff) === 0
      ? 'No ratio required'
      : `${row.staff_count}/${row.required_staff} staff`,
    danger: Number(row.required_staff) > 0 && Number(row.staff_count) < Number(row.required_staff),
  }));
  const staffRows = (pack?.staff || []).map(row => {
    const complete = staffComplete(row, pack.today);
    return {
      key: row.id,
      title: row.name,
      detail: `${(row.credentials || []).filter(item => item.required).length} required checklist item(s)`,
      status: complete ? 'Complete' : 'Review',
      danger: !complete,
    };
  });
  const drillRows = (pack?.drills || []).map(row => ({
    key: row.id,
    title: `${String(row.kind).replaceAll('_', ' ')} · ${row.lead_name}`,
    detail: `${dateTime(row.conducted_at, pack.timezone)} · ${Math.floor(Number(row.duration_seconds || 0) / 60)}m ${Number(row.duration_seconds || 0) % 60}s`,
    status: row.voided_at ? 'Voided' : 'Recorded',
    danger: Boolean(row.voided_at),
  }));
  const incidentRows = (pack?.incidents || []).map(row => ({
    key: row.id,
    title: `${row.child_name} · ${row.severity}`,
    detail: dateTime(row.occurred_at, pack.timezone),
    status: row.signed_off_at ? 'Signed off' : 'Needs sign-off',
    danger: !row.signed_off_at,
  }));
  const documentRows = (pack?.documents || []).map(row => ({
    key: row.id,
    title: `${row.title} · v${row.version}`,
    detail: `${String(row.category).replaceAll('_', ' ')} · ${row.expires_on ? `expires ${row.expires_on}` : 'no expiry'}`,
    status: 'Included',
  }));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.title}>Inspection pack</Text>
          <Text style={styles.subtitle}>{pack?.center_name || 'Center compliance summary'}</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        {error ? <TouchableOpacity style={styles.errorCard} onPress={() => load()}><Text style={styles.errorText}>{error} Tap to reload.</Text></TouchableOpacity> : null}
        {pack ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><Ionicons name="shield-checkmark" size={27} color={colors.primary} /></View>
              <Text style={styles.heroTitle}>Live compliance record summary</Text>
              <Text style={styles.heroText}>Generated {dateTime(pack.generated_at, pack.timezone)} · {pack.timezone}</Text>
              <View style={styles.metrics}>
                <SummaryMetric value={`${summary.score}%`} label="record checks" />
                <SummaryMetric value={summary.ratio == null ? '—' : `${summary.ratio}%`} label="ratio minutes" />
                <SummaryMetric value={String(summary.unsigned)} label="unsigned incidents" tone={summary.unsigned ? 'danger' : 'blue'} />
              </View>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={printPack} disabled={Boolean(busy)} accessibilityLabel="Open print preview">
                  {busy === 'print' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="print-outline" size={18} color={colors.primary} />}
                  <Text style={styles.secondaryButtonText}>Print</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={confirmShare} disabled={Boolean(busy)} accessibilityLabel="Share inspection pack PDF">
                  {busy === 'share' ? <ActivityIndicator color={colors.white} /> : <Ionicons name="share-outline" size={18} color={colors.white} />}
                  <Text style={styles.primaryButtonText}>Share PDF</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.notice}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.amber} />
              <Text style={styles.noticeText}>The PDF is a minimized register. Staff originals, incident narratives and photos remain in their protected workflows.</Text>
            </View>

            <RegisterSection icon="people-outline" title="Today’s sign-in sheets" detail={`${attendanceRows.length} recorded entries`} rows={attendanceRows} empty="No attendance entries have been recorded today." />
            <RegisterSection icon="pulse-outline" title="Ratio coverage ledger" detail={`${ledger.observed_minutes || 0} observed minutes · ${ledger.over_minutes || 0} over ratio`} rows={ratioRows} empty="No ratio intervals have been captured yet." />
            <RegisterSection icon="ribbon-outline" title="Staff files & certificates" detail={`${summary.completeStaff}/${staffRows.length} required checklists complete`} rows={staffRows} empty="No active staff files are available." />
            <RegisterSection icon="flame-outline" title="Drill history" detail="Last 12 months" rows={drillRows} empty="No drill records in this window." />
            <RegisterSection icon="medkit-outline" title="Incident register" detail="Submitted reports · last 12 months" rows={incidentRows} empty="No submitted incidents in this window." />
            <RegisterSection icon="document-text-outline" title="Included center documents" detail="Current inspector-visible versions only" rows={documentRows} empty="No documents are selected for this pack." />
            <Text style={styles.footer}>This readiness summary checks record completeness. It is not legal advice or a certification of regulatory compliance.</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 20 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { padding: spacing.xl, paddingBottom: 48 },
  hero: { alignItems: 'center', padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  heroIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.primaryLight },
  heroTitle: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18, textAlign: 'center' },
  heroText: { marginTop: 4, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, textAlign: 'center' },
  metrics: { width: '100%', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  metric: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  metricValue: { color: colors.primary, fontFamily: fonts.black, fontSize: 19 },
  metricDanger: { color: colors.danger },
  metricLabel: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 9.5 },
  actions: { width: '100%', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  secondaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  primaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginVertical: spacing.lg, padding: spacing.md, borderWidth: 1, borderColor: '#EBCB93', borderRadius: radius.md, backgroundColor: colors.amberLight },
  noticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  section: { overflow: 'hidden', marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.primarySoft },
  sectionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14 },
  sectionDetail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  registerRow: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  rowTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5, textTransform: 'capitalize' },
  rowDetail: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  rowStatus: { color: colors.success, fontFamily: fonts.bold, fontSize: 10.5, textTransform: 'capitalize' },
  rowStatusDanger: { color: colors.danger },
  empty: { padding: spacing.lg, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  more: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, color: colors.primary, fontFamily: fonts.bold, fontSize: 11 },
  footer: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 16, textAlign: 'center' },
  errorCard: { padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
});
