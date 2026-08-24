import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { colors, fonts, radius, spacing } from '../../theme';
import { EmptyState } from '../../components/ui';
import { useParentDocuments } from '../../hooks/useParentDocuments';
import { useParentFamily } from '../../hooks/useParentFamily';
import { ErrorCard, ParentAccountHeader } from './ParentAccountShared';

const STATUS = {
  requested: { label: 'Upload', color: colors.amber, background: colors.amberLight },
  rejected: { label: 'Fix & upload', color: colors.danger, background: colors.dangerLight },
  under_review: { label: 'Under review', color: colors.primary, background: colors.primaryLight },
  accepted: { label: 'On file', color: colors.success, background: colors.successLight },
  verified: { label: 'Verified', color: colors.success, background: colors.successLight },
  uploaded: { label: 'On file', color: colors.success, background: colors.successLight },
  signed: { label: 'Signed', color: colors.success, background: colors.successLight },
  submitted: { label: 'Submitted', color: colors.primary, background: colors.primaryLight },
  on_file: { label: 'On file', color: colors.success, background: colors.successLight },
};

function dateLabel(value, fallback = '') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function ChildPicker({ children, selectedId, onSelect }) {
  if (children.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childPicker}>
      {children.map((child) => {
        const selected = child.id === selectedId;
        return (
          <TouchableOpacity
            key={child.id}
            style={[styles.childChip, selected && styles.childChipSelected]}
            onPress={() => onSelect(child.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.childChipText, selected && styles.childChipTextSelected]}>{child.first_name}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function RequestCard({ request, child, onPress }) {
  const meta = STATUS[request.status] || STATUS.requested;
  const needsAction = request.status === 'requested' || request.status === 'rejected';
  return (
    <TouchableOpacity
      style={[styles.requestCard, request.status === 'rejected' && styles.requestRejected]}
      onPress={onPress}
      activeOpacity={needsAction ? 0.72 : 1}
      disabled={!needsAction}
      accessibilityLabel={`${request.title}. ${meta.label}`}
    >
      <View style={[styles.requestIcon, { backgroundColor: needsAction ? colors.surface : colors.primarySoft }]}>
        <Ionicons name={request.status === 'rejected' ? 'alert-circle-outline' : request.status === 'under_review' ? 'time-outline' : 'notifications-outline'} size={20} color={meta.color} />
      </View>
      <View style={styles.flexOne}>
        <Text style={styles.requestTitle}>{request.title}</Text>
        <Text style={[styles.requestSubtitle, needsAction && { color: meta.color }]} numberOfLines={2}>
          {request.status === 'rejected'
            ? request.rejection_reason || 'The office asked for another copy.'
            : request.status === 'under_review'
              ? `Uploaded ${dateLabel(request.submitted_at, 'recently')} · waiting for review`
              : `${child.first_name} · ${request.due_on ? `due ${dateLabel(request.due_on)}` : 'requested by the office'}`}
        </Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: meta.background }]}>
        <Text style={[styles.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function DocumentRow({ record, onPress }) {
  const meta = STATUS[record.status] || STATUS.on_file;
  const health = record.category === 'health';
  const subtitle = record.source_type === 'agreement'
    ? `Signed ${dateLabel(record.recorded_at)} · PDF`
    : record.source_type === 'application_summary'
      ? `Submitted ${dateLabel(record.recorded_at)}`
      : record.source_type === 'health_summary'
        ? 'On file · current family record'
      : `${meta.label} · updated ${dateLabel(record.recorded_at, 'recently')}`;
  return (
    <TouchableOpacity style={styles.documentRow} onPress={onPress} activeOpacity={0.72}>
      <View style={[styles.documentIcon, { backgroundColor: health ? colors.successLight : colors.primarySoft }]}>
        <Ionicons name={health ? 'medkit-outline' : 'document-text-outline'} size={20} color={health ? colors.success : colors.primary} />
      </View>
      <View style={styles.flexOne}>
        <Text style={styles.documentTitle}>{record.title}</Text>
        <Text style={styles.documentSubtitle}>{subtitle}</Text>
      </View>
      {record.source_type === 'application_summary' ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      ) : (
        <Ionicons name="download-outline" size={20} color={colors.primary} />
      )}
    </TouchableOpacity>
  );
}

function ShortcutRow({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.documentRow} onPress={onPress} activeOpacity={0.72}>
      <View style={styles.documentIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View>
      <View style={styles.flexOne}>
        <Text style={styles.documentTitle}>{title}</Text>
        <Text style={styles.documentSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function ParentDocumentsScreen({ navigation, route }) {
  const { hub, loading, error, refresh } = useParentDocuments();
  const family = useParentFamily();
  const [selectedChildId, setSelectedChildId] = useState(
    route.params?.childId || family.selectedChildId || null
  );
  const openedRequestRef = useRef(null);
  const openedRecordRef = useRef(null);

  useFocusEffect(useCallback(() => {
    refresh().then((data) => {
      setSelectedChildId((current) => (
        (data?.children || []).some((child) => child.id === current)
          ? current
          : (data?.children || []).some((child) => child.id === family.selectedChildId)
            ? family.selectedChildId
            : data?.children?.[0]?.id || null
      ));
    }).catch(() => {});
  }, [family.selectedChildId, refresh]));

  const children = hub?.children || [];
  const child = useMemo(
    () => children.find((item) => item.id === selectedChildId) || children[0] || null,
    [children, selectedChildId],
  );
  const requests = child?.requests || [];
  const actionRequests = requests.filter((request) => ['requested', 'rejected'].includes(request.status));
  const reviewRequests = requests.filter((request) => request.status === 'under_review');
  const enrollmentRecords = (child?.records || []).filter((record) => record.category === 'enrollment');
  const healthRecords = (child?.records || []).filter((record) => record.category === 'health');

  const selectChild = useCallback((childId) => {
    setSelectedChildId(childId);
    family.selectChild(childId);
  }, [family.selectChild]);

  useEffect(() => {
    const routeChildId = route.params?.childId;
    if (routeChildId && children.some((candidate) => candidate.id === routeChildId)) {
      selectChild(routeChildId);
    }
  }, [children, route.params?.childId, selectChild]);

  function openRequest(request) {
    navigation.navigate('ParentDocumentUpload', {
      requestId: request.id,
      childId: child.id,
      request,
      child,
    });
  }

  function openRecord(record) {
    navigation.navigate('ParentDocumentViewer', {
      recordId: record.id,
      sourceType: record.source_type,
      childId: child.id,
      record,
      child,
    });
  }

  useEffect(() => {
    const focusRequestId = route.params?.focusRequestId;
    if (!hub || !focusRequestId || openedRequestRef.current === focusRequestId) return;
    let found = false;
    for (const candidateChild of hub.children || []) {
      const request = (candidateChild.requests || []).find((item) => item.id === focusRequestId);
      if (!request) continue;
      found = true;
      openedRequestRef.current = focusRequestId;
      selectChild(candidateChild.id);
      navigation.setParams({ childId: candidateChild.id, focusRequestId: undefined });
      if (['requested', 'rejected'].includes(request.status)) {
        navigation.navigate('ParentDocumentUpload', {
          requestId: request.id,
          childId: candidateChild.id,
          request,
          child: candidateChild,
        });
      } else if (request.status === 'accepted' && request.latest_document?.id) {
        const record = (candidateChild.records || []).find((item) => item.id === request.latest_document.id);
        if (record) {
          navigation.navigate('ParentDocumentViewer', {
            recordId: record.id,
            sourceType: record.source_type,
            childId: candidateChild.id,
            record,
            child: candidateChild,
          });
        }
      }
      break;
    }
    if (!found) {
      openedRequestRef.current = focusRequestId;
      navigation.setParams({ focusRequestId: undefined });
      navigation.navigate('ParentDocumentUpload', {
        requestId: focusRequestId,
        childId: route.params?.childId,
      });
    }
  }, [hub, navigation, route.params?.childId, route.params?.focusRequestId, selectChild]);

  useEffect(() => {
    const focusRecordId = route.params?.focusRecordId;
    if (!hub || !focusRecordId || openedRecordRef.current === focusRecordId) return;
    let found = false;
    for (const candidateChild of hub.children || []) {
      const record = (candidateChild.records || []).find((item) => (
        item.id === focusRecordId
        && (!route.params?.focusSourceType || item.source_type === route.params.focusSourceType)
      ));
      if (!record) continue;
      found = true;
      openedRecordRef.current = focusRecordId;
      selectChild(candidateChild.id);
      navigation.setParams({
        childId: candidateChild.id,
        focusRecordId: undefined,
        focusSourceType: undefined,
      });
      navigation.navigate('ParentDocumentViewer', {
        recordId: record.id,
        sourceType: record.source_type,
        childId: candidateChild.id,
        record,
        child: candidateChild,
      });
      break;
    }
    if (!found) {
      openedRecordRef.current = focusRecordId;
      navigation.setParams({ focusRecordId: undefined, focusSourceType: undefined });
      navigation.navigate('ParentDocumentViewer', {
        recordId: focusRecordId,
        sourceType: route.params?.focusSourceType,
        childId: route.params?.childId,
      });
    }
  }, [hub, navigation, route.params?.childId, route.params?.focusRecordId, route.params?.focusSourceType, selectChild]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader navigation={navigation} title="Documents" subtitle={child ? `${child.first_name}'s family record` : 'Your family paperwork'} />
      {!hub && loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : null}
      {error && !hub ? <View style={styles.errorWrap}><ErrorCard message={error} onRetry={() => refresh().catch(() => {})} /></View> : null}
      {hub ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} tintColor={colors.primary} />}
        >
          <ChildPicker children={children} selectedId={child?.id} onSelect={selectChild} />

          {!child ? <EmptyState icon="📄" message="Link a child before viewing family documents." /> : null}

          {actionRequests.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>NEEDS YOUR ATTENTION</Text>
              {actionRequests.map((request) => (
                <RequestCard key={request.id} request={request} child={child} onPress={() => openRequest(request)} />
              ))}
            </View>
          ) : null}

          {reviewRequests.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>WITH THE OFFICE</Text>
              {reviewRequests.map((request) => (
                <RequestCard key={request.id} request={request} child={child} />
              ))}
            </View>
          ) : null}

          {child ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>ENROLLMENT & AGREEMENTS</Text>
                {enrollmentRecords.map((record) => <DocumentRow key={`${record.source_type}-${record.id}`} record={record} onPress={() => openRecord(record)} />)}
                {!enrollmentRecords.length ? (
                  <View style={styles.emptySection}><Text style={styles.emptySectionText}>Enrollment records will appear here after the application is completed.</Text></View>
                ) : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>HEALTH & CONSENTS</Text>
                {healthRecords.map((record) => <DocumentRow key={`${record.source_type}-${record.id}`} record={record} onPress={() => openRecord(record)} />)}
                <ShortcutRow
                  icon="shield-checkmark-outline"
                  title="Photo & outing consents"
                  subtitle="Manage what you allow"
                  onPress={() => navigation.navigate('ParentConsents', { child })}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>STATEMENTS & TAX</Text>
                <ShortcutRow
                  icon="receipt-outline"
                  title="Monthly statements & tax"
                  subtitle="Year-end childcare receipt and monthly PDFs"
                  onPress={() => navigation.navigate('ParentStatements')}
                />
              </View>
            </>
          ) : null}

          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
            <Text style={styles.securityText}>Documents are private to your linked family and authorized center administrators.</Text>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorWrap: { padding: spacing.xl },
  content: { paddingHorizontal: 22, paddingBottom: 44, gap: spacing.lg },
  flexOne: { flex: 1, minWidth: 0 },
  childPicker: { gap: spacing.sm, paddingBottom: spacing.xs },
  childChip: {
    paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: radius.full,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
  },
  childChipSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  childChipText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13 },
  childChipTextSelected: { color: colors.primary },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11,
    letterSpacing: 0.75, paddingHorizontal: 2, marginBottom: 1,
  },
  requestCard: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.amberLight, borderWidth: 1.5, borderColor: '#EFD9B5',
    borderRadius: 16, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  requestRejected: { backgroundColor: colors.dangerLight, borderColor: '#E8BEBE' },
  requestIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  requestTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 13.5 },
  requestSubtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  statusBadgeText: { fontFamily: fonts.bold, fontSize: 10.5 },
  documentRow: {
    minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  documentIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  documentTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  documentSubtitle: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  emptySection: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  emptySectionText: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  securityNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: radius.lg,
  },
  securityText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
});
