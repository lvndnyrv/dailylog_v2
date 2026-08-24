import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday } from 'date-fns';

import { ChildAvatar } from '../../components/ChildAvatar';
import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { Button, EmptyState } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const SEVERITY_META = {
  minor: { label: 'Minor', color: colors.success, bg: colors.successLight },
  moderate: { label: 'Moderate', color: colors.amber, bg: colors.amberLight },
  serious: { label: 'Serious', color: colors.danger, bg: colors.dangerLight },
};

function statusMeta(report) {
  if (report.status === 'acknowledged') {
    return { label: 'Parent acknowledged', color: colors.success, bg: colors.successLight, icon: 'checkmark' };
  }
  if (report.status === 'signed_off') {
    return { label: 'Signed off · parents notified', color: colors.success, bg: colors.successLight, icon: 'checkmark' };
  }
  if (report.status === 'submitted' && report.severity === 'serious') {
    return { label: 'Parents notified · sign-off pending', color: colors.danger, bg: colors.dangerLight, icon: 'alert' };
  }
  if (report.status === 'submitted') {
    return { label: 'Awaiting director sign-off', color: colors.amber, bg: colors.amberLight, icon: 'time' };
  }
  return { label: 'Draft', color: colors.amber, bg: colors.amberLight, icon: 'create' };
}

function childName(child) {
  return [child?.first_name, child?.last_name].filter(Boolean).join(' ') || 'Child';
}

function classroomInitials(name) {
  return String(name || 'Room')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function IncidentHubScreen({ navigation }) {
  const { profile } = useAuth();
  const { active } = useClassroom();
  const [reports, setReports] = useState([]);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showChildren, setShowChildren] = useState(false);

  const load = useCallback(async () => {
    if (!active?.id || !profile?.id) {
      setReports([]);
      setChildren([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [{ data: childRows }, { data: incidentRows }] = await Promise.all([
      supabase
        .from('children')
        .select('id, first_name, last_name, classroom_id, photo_url')
        .eq('classroom_id', active.id)
        .is('archived_at', null)
        .order('first_name'),
      supabase
        .from('incident_reports')
        .select('*, child:children(id, first_name, last_name, classroom_id, photo_url)')
        .eq('classroom_id', active.id)
        .order('updated_at', { ascending: false })
        .limit(30),
    ]);

    setChildren(childRows || []);
    setReports(incidentRows || []);
    setLoading(false);
  }, [active?.id, profile?.id]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const ownDrafts = useMemo(
    () => reports.filter(report => report.status === 'draft' && report.educator_id === profile?.id),
    [reports, profile?.id],
  );
  const recentReports = useMemo(
    () => reports.filter(report => report.status !== 'draft').slice(0, 12),
    [reports],
  );

  function startReport(child) {
    setShowChildren(false);
    navigation.navigate('IncidentReport', { child });
  }

  function finishDraft(report) {
    navigation.navigate('IncidentReport', {
      child: report.child,
      reportId: report.id,
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerIcon}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incidents</Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ClassroomSwitcher />

        <View style={styles.scopePill}>
          <View style={styles.scopeAvatar}>
            <Text style={styles.scopeAvatarText}>{classroomInitials(active?.name)}</Text>
          </View>
          <Text style={styles.scopeText}>{active?.name || 'Classroom'} · Today</Text>
        </View>

        <Button
          label="+ Report an incident"
          onPress={() => setShowChildren(true)}
          disabled={!children.length}
          style={styles.newButton}
        />

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <>
            {ownDrafts.map(report => (
              <View key={report.id} style={styles.draftCard}>
                <View style={styles.draftIcon}>
                  <Ionicons name="alert-outline" size={18} color={colors.amber} />
                </View>
                <View style={styles.draftCopy}>
                  <Text style={styles.draftTitle}>
                    {ownDrafts.length === 1 ? '1 draft not submitted' : `${ownDrafts.length} drafts not submitted`}
                  </Text>
                  <Text style={styles.draftSub} numberOfLines={2}>
                    {childName(report.child)} · {report.injury_type || 'incident'} · started{' '}
                    {format(new Date(report.created_at || report.occurred_at), 'h:mm a')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => finishDraft(report)}
                  style={styles.finishButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Finish ${childName(report.child)} incident draft`}
                >
                  <Text style={styles.finishText}>Finish</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.recentCard}>
              <Text style={styles.sectionTitle}>Recent reports</Text>
              {!recentReports.length ? (
                <EmptyState icon="🛡️" message="No incident reports for this classroom yet." />
              ) : (
                recentReports.map((report, index) => {
                  const severity = SEVERITY_META[report.severity] || SEVERITY_META.minor;
                  const status = statusMeta(report);
                  return (
                    <View key={report.id}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.reportRow}>
                        <ChildAvatar child={report.child} size={42} />
                        <View style={styles.reportCopy}>
                          <View style={styles.reportNameRow}>
                            <Text style={styles.reportName} numberOfLines={1}>
                              {childName(report.child)}
                            </Text>
                            <View style={[styles.severityBadge, { backgroundColor: severity.bg }]}>
                              <Text style={[styles.severityText, { color: severity.color }]}>
                                {severity.label}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.reportSub} numberOfLines={2}>
                            {report.injury_type} · {report.location} ·{' '}
                            {isToday(new Date(report.occurred_at))
                              ? format(new Date(report.occurred_at), 'h:mm a')
                              : format(new Date(report.occurred_at), 'MMM d')}
                          </Text>
                          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                            <Ionicons
                              name={status.icon === 'time' ? 'time-outline' : status.icon === 'alert' ? 'alert-circle-outline' : 'checkmark'}
                              size={12}
                              color={status.color}
                            />
                            <Text style={[styles.statusText, { color: status.color }]}>
                              {status.label}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <Text style={styles.policyNote}>
              Serious incidents notify the director and parents immediately, before sign-off.
              Every report locks once signed.
            </Text>
          </>
        )}
      </ScrollView>

      <Modal
        visible={showChildren}
        transparent
        animationType="slide"
        onRequestClose={() => setShowChildren(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            style={styles.sheetDismiss}
            activeOpacity={1}
            onPress={() => setShowChildren(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Who was involved?</Text>
                <Text style={styles.sheetSub}>Choose a child from {active?.name || 'this classroom'}.</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowChildren(false)}
                style={styles.sheetClose}
                accessibilityRole="button"
                accessibilityLabel="Close child selector"
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.childList} showsVerticalScrollIndicator={false}>
              {children.map((child, index) => (
                <TouchableOpacity
                  key={child.id}
                  onPress={() => startReport(child)}
                  style={[styles.childRow, index > 0 && styles.childRowBorder]}
                  activeOpacity={0.72}
                >
                  <ChildAvatar child={child} size={42} />
                  <Text style={styles.childName}>{childName(child)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontFamily: fonts.black, color: colors.textPrimary },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: 42 },
  scopePill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.full,
    padding: 5,
    paddingRight: spacing.lg,
    marginTop: spacing.sm,
  },
  scopeAvatar: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeAvatarText: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary },
  scopeText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textPrimary },
  newButton: { marginTop: spacing.lg, marginBottom: spacing.lg },
  loader: { paddingVertical: 60 },
  draftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.amberLight,
    borderWidth: 1.5,
    borderColor: '#EFD9B5',
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  draftIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#F6E4C0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftCopy: { flex: 1, minWidth: 0 },
  draftTitle: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textPrimary },
  draftSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: '#8A6D3B',
  },
  finishButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  finishText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  recentCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  divider: { height: 1, backgroundColor: colors.primarySoft, marginVertical: spacing.md },
  reportRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  reportCopy: { flex: 1, minWidth: 0 },
  reportNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportName: { flex: 1, fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  reportSub: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  severityBadge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  severityText: { fontSize: 10.5, fontFamily: fonts.bold },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginTop: spacing.sm,
  },
  statusText: { fontSize: 11.5, fontFamily: fonts.bold },
  policyNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,40,70,0.42)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    maxHeight: '68%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 38,
  },
  sheetGrabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  sheetSub: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 3,
  },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childList: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  childRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  childName: { flex: 1, fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
});
