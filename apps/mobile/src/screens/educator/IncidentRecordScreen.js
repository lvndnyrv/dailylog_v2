import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { exportIncidentPdf } from '../../lib/export';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const SEVERITY = {
  minor: { label: 'Minor incident', color: colors.success, bg: colors.successLight, border: '#B8DEC9' },
  moderate: { label: 'Moderate incident', color: colors.amber, bg: colors.amberLight, border: '#EFD9B5' },
  serious: { label: 'Serious incident', color: colors.danger, bg: colors.dangerLight, border: '#E7BEBE' },
};

function fullName(person, fallback = '—') {
  return person?.full_name || fallback;
}

function childName(child) {
  return [child?.first_name, child?.last_name].filter(Boolean).join(' ') || 'Child';
}

function DetailCard({ label, children }) {
  if (!children) return null;
  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailText}>{children}</Text>
    </View>
  );
}

function TimelineRow({ state, title, detail, last }) {
  const done = state === 'done';
  const active = state === 'active';
  const color = done ? colors.success : active ? colors.amber : colors.textFaint;
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineDot, { borderColor: color, backgroundColor: done ? color : colors.surface }]}>
          {done ? <Ionicons name="checkmark" size={11} color={colors.white} /> : null}
        </View>
        {!last ? <View style={[styles.timelineLine, done && styles.timelineLineDone]} /> : null}
      </View>
      <View style={[styles.timelineCopy, !last && styles.timelineCopySpaced]}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={[styles.timelineDetail, active && styles.timelineDetailActive]}>{detail}</Text>
      </View>
    </View>
  );
}

export default function IncidentRecordScreen({ navigation, route }) {
  const incidentId = route.params?.incidentId || route.params?.incident?.id;
  const [incident, setIncident] = useState(route.params?.incident || null);
  const [acknowledgment, setAcknowledgment] = useState(null);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [loading, setLoading] = useState(!route.params?.incident);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!incidentId) {
      setError('This incident record could not be identified.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const [{ data, error: reportError }, { data: receipt }] = await Promise.all([
      supabase
        .from('incident_reports')
        .select(`*,
          child:children(id, first_name, last_name, classroom_id),
          educator:profiles!incident_reports_educator_id_fkey(id, full_name),
          director:profiles!incident_reports_signed_off_by_fkey(id, full_name),
          first_aid_provider:profiles!incident_reports_first_aid_by_fkey(id, full_name),
          witness:profiles!incident_reports_witness_id_fkey(id, full_name)`)
        .eq('id', incidentId)
        .maybeSingle(),
      supabase
        .from('incident_acknowledgments')
        .select('id, signed_name, statement_text, acknowledged_at')
        .eq('incident_id', incidentId)
        .maybeSingle(),
    ]);
    if (reportError || !data) {
      setError(reportError?.message || 'This incident record is unavailable.');
      setLoading(false);
      return;
    }
    setIncident(data);
    setAcknowledgment(receipt || null);
    const paths = data.photo_paths || [];
    const urls = await Promise.all(paths.map(async (path) => {
      const { data: signed } = await supabase.storage.from('incident-photos').createSignedUrl(path, 3600);
      return signed?.signedUrl || null;
    }));
    setPhotoUrls(urls.filter(Boolean));
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    load();
    if (!incidentId) return undefined;
    const channel = supabase
      .channel(`staff-incident-record:${incidentId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'incident_reports', filter: `id=eq.${incidentId}`,
      }, () => load())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'incident_acknowledgments', filter: `incident_id=eq.${incidentId}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [incidentId, load]);

  async function exportPdf() {
    try {
      await exportIncidentPdf({
        incident: { ...incident, acknowledgment },
        child: incident?.child,
      });
    } catch (exportError) {
      Alert.alert('Could not export report', exportError.message);
    }
  }

  if (loading && !incident) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View></SafeAreaView>;
  }

  if (error && !incident) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Incident record</Text><View style={styles.headerButton} />
        </View>
        <View style={styles.center}>
          <Ionicons name="document-outline" size={42} color={colors.textFaint} />
          <Text style={styles.errorTitle}>Record unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const tone = SEVERITY[incident?.severity] || SEVERITY.minor;
  const signedOff = Boolean(incident?.signed_off_at);
  const acknowledgedAt = acknowledgment?.acknowledged_at || incident?.parent_acknowledged_at;
  const acknowledgedBy = acknowledgment?.signed_name || incident?.parent_acknowledge_name;
  const reporter = fullName(incident?.educator, 'Educator');
  const witness = fullName(incident?.witness, incident?.witnesses?.[0] || '—');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incident record</Text>
        <TouchableOpacity style={styles.headerButton} onPress={exportPdf} accessibilityLabel="Export incident PDF">
          <Ionicons name="share-outline" size={21} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.severityCard, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <View style={[styles.severityIcon, { backgroundColor: colors.surface }]}>
            <Ionicons name="shield-checkmark-outline" size={24} color={tone.color} />
          </View>
          <View style={styles.severityCopy}>
            <Text style={styles.childName}>{childName(incident?.child)}</Text>
            <Text style={[styles.severityLabel, { color: tone.color }]}>{tone.label} · {incident?.injury_type}</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>WHEN</Text><Text style={styles.summaryValue}>{format(new Date(incident.occurred_at), 'MMM d, yyyy · h:mm a')}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>WHERE</Text><Text style={styles.summaryValue}>{incident.location || '—'}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>AREA</Text><Text style={styles.summaryValue}>{incident.body_parts?.join(', ') || '—'}</Text></View>
        </View>

        <DetailCard label="WHAT HAPPENED">{incident.description}</DetailCard>
        <DetailCard label="CARE GIVEN">{incident.first_aid_given || 'No first aid was required.'}</DetailCard>

        <View style={styles.staffCard}>
          <Text style={styles.detailLabel}>STAFF ACCOUNTABILITY</Text>
          <View style={styles.staffRow}><Text style={styles.staffKey}>Reported by</Text><Text style={styles.staffValue}>{reporter}</Text></View>
          <View style={styles.staffRow}><Text style={styles.staffKey}>Care provided by</Text><Text style={styles.staffValue}>{fullName(incident.first_aid_provider, reporter)}</Text></View>
          <View style={styles.staffRow}><Text style={styles.staffKey}>Witness</Text><Text style={styles.staffValue}>{witness}</Text></View>
        </View>

        {incident.photo_paths?.length ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>PHOTO EVIDENCE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photoUrls.map((url) => <Image key={url} source={{ uri: url }} style={styles.photo} />)}
              {!photoUrls.length ? <Text style={styles.photoUnavailable}>Photos are temporarily unavailable.</Text> : null}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.timelineCard}>
          <Text style={styles.sectionTitle}>REPORT HANDOFF</Text>
          <TimelineRow
            state="done"
            title="Submitted by educator"
            detail={`${reporter}${incident.submitted_at ? ` · ${format(new Date(incident.submitted_at), 'MMM d, h:mm a')}` : ''}`}
          />
          <TimelineRow
            state={signedOff ? 'done' : 'active'}
            title="Director sign-off"
            detail={signedOff
              ? `${fullName(incident.director, 'Director')} · ${format(new Date(incident.signed_off_at), 'MMM d, h:mm a')}`
              : 'Pending in the admin incident queue'}
          />
          <TimelineRow
            state={acknowledgedAt ? 'done' : signedOff || incident.severity === 'serious' ? 'active' : 'future'}
            title="Parent acknowledgment"
            detail={acknowledgedAt
              ? `${acknowledgedBy || 'Parent'} · ${format(new Date(acknowledgedAt), 'MMM d, h:mm a')}`
              : incident.parent_notified_at ? 'Family notified · acknowledgment pending' : 'Sent after director sign-off'}
            last
          />
        </View>

        {acknowledgment ? (
          <View style={styles.receiptCard}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.success} />
            <View style={styles.receiptCopy}>
              <Text style={styles.receiptTitle}>Signed family receipt</Text>
              <Text style={styles.receiptText}>{acknowledgment.statement_text}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.recordNote}>This signed safety record is retained in the child’s history. Corrections remain auditable.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  errorTitle: { marginTop: spacing.lg, color: colors.textPrimary, fontSize: 19, fontFamily: fonts.bold },
  errorText: { marginTop: spacing.sm, color: colors.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  retryButton: { marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  retryText: { color: colors.white, fontSize: 13, fontFamily: fonts.bold },
  severityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderWidth: 1.5, borderRadius: radius.xl },
  severityIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  severityCopy: { flex: 1 },
  childName: { color: colors.textPrimary, fontSize: 17, fontFamily: fonts.black },
  severityLabel: { marginTop: 3, fontSize: 12.5, fontFamily: fonts.bold },
  summaryCard: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  summaryLabel: { width: 56, color: colors.textFaint, fontSize: 10.5, letterSpacing: 1, fontFamily: fonts.bold },
  summaryValue: { flex: 1, color: colors.textPrimary, textAlign: 'right', fontSize: 13, fontFamily: fonts.regular },
  detailCard: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, backgroundColor: colors.surface },
  detailLabel: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1, fontFamily: fonts.bold },
  detailText: { marginTop: 7, color: colors.textSecondary, fontSize: 14, lineHeight: 22, fontFamily: fonts.regular },
  staffCard: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, backgroundColor: colors.surface },
  staffRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  staffKey: { flex: 1, color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  staffValue: { flex: 1.2, color: colors.textPrimary, textAlign: 'right', fontSize: 12, fontFamily: fonts.bold },
  photoRow: { gap: spacing.sm, paddingTop: spacing.md },
  photo: { width: 132, height: 106, borderRadius: radius.md, backgroundColor: colors.bg },
  photoUnavailable: { paddingVertical: spacing.lg, color: colors.textFaint, fontSize: 12, fontFamily: fonts.regular },
  timelineCard: { marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  sectionTitle: { marginBottom: spacing.md, color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  timelineRow: { flexDirection: 'row' },
  timelineRail: { width: 24, alignItems: 'center' },
  timelineDot: { zIndex: 1, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10 },
  timelineLine: { position: 'absolute', top: 19, bottom: -6, width: 2, backgroundColor: colors.border },
  timelineLineDone: { backgroundColor: '#B8DEC9' },
  timelineCopy: { flex: 1, paddingLeft: spacing.sm },
  timelineCopySpaced: { paddingBottom: spacing.lg },
  timelineTitle: { color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold },
  timelineDetail: { marginTop: 3, color: colors.textMuted, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular },
  timelineDetailActive: { color: colors.amber, fontFamily: fonts.bold },
  receiptCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.successLight },
  receiptCopy: { flex: 1 },
  receiptTitle: { color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold },
  receiptText: { marginTop: 4, color: colors.textMuted, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  recordNote: { marginTop: spacing.lg, color: colors.textFaint, textAlign: 'center', fontSize: 10.5, lineHeight: 16, fontFamily: fonts.regular },
});
