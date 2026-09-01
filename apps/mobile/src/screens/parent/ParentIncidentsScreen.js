import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isThisYear } from 'date-fns';

import { useParentIncidents } from '../../hooks/useParentIncidents';
import { colors, fonts, radius, spacing } from '../../theme';
import { ParentAccountHeader } from './ParentAccountShared';

const SEVERITY = {
  minor: { label: 'Minor', color: colors.amber, bg: colors.amberLight },
  moderate: { label: 'Moderate', color: colors.coral, bg: colors.coralLight },
  serious: { label: 'Serious', color: colors.danger, bg: colors.dangerLight },
};

function ReportRow({ report, onPress }) {
  const tone = SEVERITY[report.severity] || SEVERITY.minor;
  const date = new Date(report.occurred_at);
  const directorReviewPending = report.director_review_required || report.status === 'submitted';
  return (
    <TouchableOpacity style={styles.reportRow} onPress={onPress} activeOpacity={0.72} accessibilityRole="button">
      <View style={[styles.reportIcon, { backgroundColor: tone.bg }]}>
        <Ionicons name="medkit-outline" size={20} color={tone.color} />
      </View>
      <View style={styles.reportCopy}>
        <View style={styles.reportHeading}>
          <Text style={styles.reportTitle}>{report.injury_type}</Text>
          {report.action_required ? (
            <View style={styles.actionBadge}><Text style={styles.actionBadgeText}>Review</Text></View>
          ) : directorReviewPending ? (
            <Ionicons name="time-outline" size={18} color={colors.amber} />
          ) : (
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          )}
        </View>
        <Text style={styles.reportMeta}>
          {format(date, isThisYear(date) ? 'MMM d · h:mm a' : 'MMM d, yyyy')} · {report.location}
        </Text>
        <Text style={styles.reportStatus}>
          {report.action_required
            ? `${tone.label} incident · acknowledgment needed`
            : directorReviewPending
              ? `Acknowledged by ${report.acknowledgment?.signed_name || report.parent_acknowledge_name || 'parent'} · director review pending`
              : `Acknowledged by ${report.acknowledgment?.signed_name || report.parent_acknowledge_name || 'parent'}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function ParentIncidentsScreen({ navigation, route }) {
  const routeChild = route.params?.child || null;
  const childId = routeChild?.id || route.params?.childId;
  const incidents = useParentIncidents(childId);
  const child = incidents.hub?.child || routeChild;
  const pending = useMemo(() => incidents.reports.filter((report) => report.action_required), [incidents.reports]);
  const history = useMemo(() => incidents.reports.filter((report) => !report.action_required), [incidents.reports]);

  function open(report) {
    navigation.navigate('IncidentDetail', { incident: report, child, childId });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader
        navigation={navigation}
        title="Incident reports"
        subtitle={child ? `${child.first_name} · ${incidents.hub?.daycare?.name || 'Your center'}` : 'Family records'}
      />

      {incidents.loading && !incidents.reports.length ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : incidents.error && !incidents.reports.length ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={30} color={colors.danger} /></View>
          <Text style={styles.emptyTitle}>Reports unavailable</Text>
          <Text style={styles.emptyText}>{incidents.error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => incidents.refresh()}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : !incidents.reports.length ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="shield-checkmark-outline" size={32} color={colors.success} /></View>
          <Text style={styles.emptyTitle}>No incident reports</Text>
          <Text style={styles.emptyText}>Reports shared by the center will remain here after you review them.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={incidents.refreshing} onRefresh={() => incidents.refresh({ quiet: true })} tintColor={colors.primary} />}
        >
          {pending.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ACTION NEEDED</Text>
              <View style={[styles.card, styles.pendingCard]}>
                {pending.map((report) => <ReportRow key={report.id} report={report} onPress={() => open(report)} />)}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>REPORT HISTORY</Text>
            {history.length ? (
              <View style={styles.card}>
                {history.map((report) => <ReportRow key={report.id} report={report} onPress={() => open(report)} />)}
              </View>
            ) : (
              <View style={styles.quietCard}><Text style={styles.quietText}>No acknowledged reports yet.</Text></View>
            )}
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} />
            <Text style={styles.infoText}>Acknowledgments are time-stamped and retained with the center’s incident record.</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: colors.surface },
  emptyTitle: { marginTop: spacing.lg, color: colors.textPrimary, fontSize: 19, fontFamily: fonts.bold },
  emptyText: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: fonts.regular },
  retry: { marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  retryText: { color: colors.white, fontSize: 13, fontFamily: fonts.bold },
  section: { marginBottom: spacing.xl },
  sectionTitle: { marginBottom: spacing.sm, marginLeft: 2, color: colors.textFaint, fontSize: 11, letterSpacing: 1.2, fontFamily: fonts.bold },
  card: { overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  pendingCard: { borderColor: '#EFD9B5' },
  reportRow: { minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  reportIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  reportCopy: { flex: 1 },
  reportHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  reportMeta: { marginTop: 3, color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.regular },
  reportStatus: { marginTop: 5, color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular },
  actionBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.amberLight },
  actionBadgeText: { color: colors.amber, fontSize: 10, fontFamily: fonts.bold },
  quietCard: { padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  quietText: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  infoCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, color: colors.textMuted, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
});
