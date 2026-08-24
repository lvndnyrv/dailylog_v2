import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isToday, isYesterday } from 'date-fns';

import { useAuth } from '../../hooks/useAuth';
import { useParentIncidents } from '../../hooks/useParentIncidents';
import { exportIncidentPdf } from '../../lib/export';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const SEVERITY = {
  minor: {
    label: 'Minor incident logged',
    message: 'Your child is fine. Please review and acknowledge below.',
    color: colors.amber,
    bg: colors.amberLight,
    border: '#EFD9B5',
  },
  moderate: {
    label: 'Incident requiring care',
    message: 'First aid was provided. Please review the complete report below.',
    color: colors.coral,
    bg: colors.coralLight,
    border: '#E9C5B9',
  },
  serious: {
    label: 'Serious incident update',
    message: 'The center shared this immediately. Please review the full report.',
    color: colors.danger,
    bg: colors.dangerLight,
    border: '#E7BEBE',
  },
};

function incidentTime(value) {
  const date = new Date(value);
  if (isToday(date)) return `Today · ${format(date, 'h:mm a')}`;
  if (isYesterday(date)) return `Yesterday · ${format(date, 'h:mm a')}`;
  return format(date, 'MMM d, yyyy · h:mm a');
}

function SummaryRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function NarrativeCard({ label, children }) {
  if (!children) return null;
  return (
    <View style={styles.narrativeCard}>
      <Text style={styles.narrativeLabel}>{label}</Text>
      <Text style={styles.narrativeText}>{children}</Text>
    </View>
  );
}

export default function IncidentDetailScreen({ route, navigation }) {
  const incidentId = route.params?.incident?.id || route.params?.incidentId;
  const routeChild = route.params?.child || null;
  const childId = routeChild?.id || route.params?.childId || route.params?.incident?.child_id;
  const incidentCenter = useParentIncidents(childId);
  const { profile } = useAuth();
  const [fallbackIncident, setFallbackIncident] = useState(route.params?.incident || null);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [signedName, setSignedName] = useState(profile?.full_name || '');
  const [signatureError, setSignatureError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const incident = useMemo(
    () => incidentCenter.reports.find((report) => report.id === incidentId) || fallbackIncident,
    [fallbackIncident, incidentCenter.reports, incidentId],
  );
  const child = incidentCenter.hub?.child || routeChild;
  const daycare = incidentCenter.hub?.daycare;
  const tone = SEVERITY[incident?.severity] || SEVERITY.minor;
  const acknowledged = Boolean(incident?.parent_acknowledged_at || incident?.acknowledgment);

  useEffect(() => {
    if (profile?.full_name && !signedName) setSignedName(profile.full_name);
  }, [profile?.full_name, signedName]);

  useEffect(() => {
    if (!incidentId || fallbackIncident || childId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('incident_reports')
        .select('*')
        .eq('id', incidentId)
        .maybeSingle();
      if (active && data) setFallbackIncident(data);
    })();
    return () => { active = false; };
  }, [childId, fallbackIncident, incidentId]);

  useEffect(() => {
    let active = true;
    async function loadPhotos() {
      const paths = incident?.photo_paths || [];
      if (!paths.length) {
        setPhotoUrls([]);
        return;
      }
      setPhotosLoading(true);
      const urls = (await Promise.all(paths.map((path) => incidentCenter.getPhotoUrl(path)))).filter(Boolean);
      if (active) {
        setPhotoUrls(urls);
        setPhotosLoading(false);
      }
    }
    loadPhotos();
    return () => { active = false; };
  }, [incident?.photo_paths, incidentCenter.getPhotoUrl]);

  async function acknowledge() {
    const normalized = signedName.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      setSignatureError('Type your full name to acknowledge this report.');
      return;
    }
    if (profile?.full_name && normalized.toLowerCase() !== profile.full_name.trim().replace(/\s+/g, ' ').toLowerCase()) {
      setSignatureError('Your signature must match the full name on your account.');
      return;
    }
    setSignatureError('');
    setSubmitting(true);
    try {
      const result = await incidentCenter.acknowledge(incident.id, normalized);
      navigation.replace('IncidentAcknowledged', { result, child, incidentId: incident.id });
    } catch (error) {
      setSignatureError(error.message || 'The acknowledgment could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  async function exportPdf() {
    try {
      await exportIncidentPdf({ incident, child });
    } catch (error) {
      Alert.alert('Could not export report', error.message);
    }
  }

  if ((incidentCenter.loading && !incident) || (!childId && !incident)) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View></SafeAreaView>;
  }

  if (!incident && (!incidentCenter.loading || incidentCenter.error)) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={styles.headerTitle}>Incident report</Text><View style={styles.headerButton} />
        </View>
        <View style={styles.center}>
          <View style={styles.unavailableIcon}><Ionicons name="document-outline" size={30} color={colors.textFaint} /></View>
          <Text style={styles.unavailableTitle}>Report unavailable</Text>
          <Text style={styles.unavailableText}>{incidentCenter.error || 'This incident report is no longer available.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const signedAt = incident.acknowledgment?.acknowledged_at || incident.parent_acknowledged_at;
  const signedBy = incident.acknowledgment?.signed_name || incident.parent_acknowledge_name;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Incident report</Text>
          <TouchableOpacity style={styles.headerButton} onPress={exportPdf} accessibilityLabel="Export report as PDF">
            <Ionicons name="share-outline" size={21} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.severityBanner, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <View style={styles.severityIcon}><Ionicons name="warning-outline" size={21} color={tone.color} /></View>
            <View style={styles.severityCopy}>
              <Text style={styles.severityTitle}>{tone.label}</Text>
              <Text style={[styles.severityMessage, { color: tone.color }]}>{tone.message.replace('Your child', child?.first_name || 'Your child')}</Text>
            </View>
          </View>

          <View style={styles.summaryCard}>
            <SummaryRow label="WHEN" value={incidentTime(incident.occurred_at)} />
            <SummaryRow label="WHERE" value={incident.location} />
            <SummaryRow label="TYPE" value={incident.injury_type} />
            {incident.body_parts?.length ? <SummaryRow label="AREA" value={incident.body_parts.join(', ')} /> : null}
          </View>

          <NarrativeCard label="WHAT HAPPENED">{incident.description}</NarrativeCard>
          <NarrativeCard label="ACTION TAKEN">{incident.first_aid_given || 'No first aid was required.'}</NarrativeCard>
          {incident.notes ? <NarrativeCard label="FOLLOW-UP NOTES">{incident.notes}</NarrativeCard> : null}

          {incident.photo_paths?.length ? (
            <View style={styles.narrativeCard}>
              <Text style={styles.narrativeLabel}>PHOTOS</Text>
              {photosLoading ? <ActivityIndicator color={colors.primary} style={styles.photoLoader} /> : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                  {photoUrls.map((url) => <Image key={url} source={{ uri: url }} style={styles.photo} />)}
                  {!photoUrls.length ? <Text style={styles.photoUnavailable}>Photos are not available right now.</Text> : null}
                </ScrollView>
              )}
            </View>
          ) : null}

          <View style={styles.byline}>
            <View style={styles.bylineAvatar}><Text style={styles.bylineInitial}>{incident.educator_name?.[0] || 'E'}</Text></View>
            <Text style={styles.bylineText}>
              Logged by <Text style={styles.bylineStrong}>{incident.educator_name || 'an educator'}</Text>
              {incident.signed_off_by_name ? ` · reviewed by ${incident.signed_off_by_name}` : ''}
            </Text>
          </View>

          {acknowledged ? (
            <View style={styles.acknowledgedCard}>
              <Ionicons name="checkmark-circle" size={25} color={colors.success} />
              <View style={styles.acknowledgedCopy}>
                <Text style={styles.acknowledgedTitle}>Acknowledged</Text>
                <Text style={styles.acknowledgedText}>Signed by {signedBy || 'Parent'}{signedAt ? ` · ${format(new Date(signedAt), 'MMM d, h:mm a')}` : ''}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.signatureCard, signatureError && styles.signatureCardError]}>
              <Text style={styles.signatureLabel}>SIGNATURE <Text style={styles.required}>*</Text></Text>
              <Text style={styles.signatureHelp}>Type your full name exactly as it appears on your account.</Text>
              <TextInput
                style={[styles.signatureInput, signatureError && styles.signatureInputError]}
                value={signedName}
                onChangeText={(value) => { setSignedName(value); setSignatureError(''); }}
                placeholder="Full name"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="Full name signature"
              />
              {signatureError ? <Text style={styles.signatureError}>{signatureError}</Text> : null}
              <Text style={styles.legalText}>Acknowledging confirms you were informed of this incident and reviewed the report. It does not waive any rights.</Text>
            </View>
          )}

          <Text style={styles.recordNote}>Report shared by {daycare?.name || 'your childcare center'} · retained in family history</Text>
        </ScrollView>

        <View style={styles.footer}>
          {acknowledged ? (
            <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('ParentIncidents', { child, childId })}>
              <Text style={styles.historyButtonText}>Back to report history</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.ackButton, submitting && styles.disabled]} onPress={acknowledge} disabled={submitting}>
              {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ackButtonText}>Acknowledge & sign</Text>}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  unavailableIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: colors.surface },
  unavailableTitle: { marginTop: spacing.lg, color: colors.textPrimary, fontSize: 18, fontFamily: fonts.bold },
  unavailableText: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: fonts.regular },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  severityBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderWidth: 1.5, borderRadius: radius.xl },
  severityIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.surface },
  severityCopy: { flex: 1 },
  severityTitle: { color: colors.textPrimary, fontSize: 15, fontFamily: fonts.bold },
  severityMessage: { marginTop: 3, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular },
  summaryCard: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  summaryLabel: { width: 62, color: colors.textFaint, fontSize: 10.5, letterSpacing: 1, fontFamily: fonts.bold },
  summaryValue: { flex: 1, color: colors.textPrimary, fontSize: 13.5, textAlign: 'right', fontFamily: fonts.regular },
  narrativeCard: { marginTop: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.xl, backgroundColor: colors.surface },
  narrativeLabel: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1, fontFamily: fonts.bold },
  narrativeText: { marginTop: 6, color: colors.textSecondary, fontSize: 14, lineHeight: 22, fontFamily: fonts.regular },
  photoLoader: { paddingVertical: spacing.xl },
  photoRow: { gap: spacing.sm, paddingTop: spacing.md },
  photo: { width: 126, height: 104, borderRadius: radius.md, backgroundColor: colors.bg },
  photoUnavailable: { paddingVertical: spacing.lg, color: colors.textFaint, fontSize: 12, fontFamily: fonts.regular },
  byline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: 2 },
  bylineAvatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.primaryLight },
  bylineInitial: { color: colors.primary, fontSize: 13, fontFamily: fonts.bold },
  bylineText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  bylineStrong: { color: colors.textPrimary, fontFamily: fonts.bold },
  signatureCard: { marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  signatureCardError: { borderColor: colors.danger },
  signatureLabel: { color: colors.textPrimary, fontSize: 12, letterSpacing: 0.8, fontFamily: fonts.bold },
  required: { color: colors.danger },
  signatureHelp: { marginTop: 4, color: colors.textMuted, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  signatureInput: { minHeight: 50, marginTop: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg, color: colors.textPrimary, fontSize: 15, fontFamily: fonts.regular },
  signatureInputError: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  signatureError: { marginTop: 6, color: colors.danger, fontSize: 11.5, fontFamily: fonts.bold },
  legalText: { marginTop: spacing.md, color: colors.textFaint, fontSize: 10.5, lineHeight: 16, fontFamily: fonts.regular },
  acknowledgedCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: '#B8DEC9', borderRadius: radius.xl, backgroundColor: colors.successLight },
  acknowledgedCopy: { flex: 1 },
  acknowledgedTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  acknowledgedText: { marginTop: 3, color: colors.success, fontSize: 11.5, fontFamily: fonts.regular },
  recordNote: { marginTop: spacing.lg, color: colors.textFaint, fontSize: 10.5, lineHeight: 15, textAlign: 'center', fontFamily: fonts.regular },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  ackButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  ackButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  historyButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  historyButtonText: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.55 },
});
