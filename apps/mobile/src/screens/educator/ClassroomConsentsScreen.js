import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useClassroom } from '../../hooks/useClassroom';
import { getClassroomConsents } from '../../hooks/useStaffVisibility';
import { EmptyState } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

const TABS = [
  { key: 'photos', label: 'Photos', noun: 'photos' },
  { key: 'trips', label: 'Trips', noun: 'local trips' },
  { key: 'water', label: 'Water', noun: 'water play' },
  { key: 'sunscreen', label: 'Sunscreen', noun: 'sunscreen' },
];

export default function ClassroomConsentsScreen({ navigation, route }) {
  const { activeClassroom } = useClassroom();
  const classroom = route.params?.classroom || activeClassroom;
  const [selectedTab, setSelectedTab] = useState('photos');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!classroom?.id) {
      setError('Choose a classroom to review permissions.');
      setLoading(false);
      return;
    }
    setError('');
    try {
      setData(await getClassroomConsents(classroom.id));
    } catch (loadError) {
      setError(loadError.message || 'Classroom consents could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [classroom?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const selectedMeta = TABS.find((tab) => tab.key === selectedTab) || TABS[0];
  const children = data?.children || [];
  const stats = useMemo(() => {
    const statuses = children.map((child) => child.permissions?.[selectedTab]?.status || 'not_set');
    return {
      allowed: statuses.filter((status) => status === 'allowed').length,
      declined: statuses.filter((status) => status === 'declined').length,
      notSet: statuses.filter((status) => status === 'not_set').length,
    };
  }, [children, selectedTab]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Classroom consents</Text>
          <Text style={styles.headerSubtitle}>{data?.classroomName || classroom?.name || 'Classroom'}</Text>
        </View>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="⚠️" message={error} />
          <TouchableOpacity onPress={load} style={styles.retry}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setSelectedTab(tab.key)}
                style={[styles.tab, selectedTab === tab.key && styles.tabActive]}
              >
                <Text style={[styles.tabText, selectedTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={stats.declined > 0 || stats.notSet > 0 ? styles.alertCard : styles.allClearCard}>
            <Ionicons
              name={stats.declined > 0 || stats.notSet > 0 ? 'alert-circle-outline' : 'checkmark-circle'}
              size={24}
              color={stats.declined > 0 || stats.notSet > 0 ? colors.danger : colors.success}
            />
            <View style={styles.alertCopy}>
              <Text style={stats.declined > 0 || stats.notSet > 0 ? styles.alertTitle : styles.allClearTitle}>
                {stats.declined > 0
                  ? `${stats.declined} of ${children.length} ${children.length === 1 ? 'child' : 'children'} declined ${selectedMeta.noun}`
                  : stats.notSet > 0
                    ? `${stats.notSet} of ${children.length} ${children.length === 1 ? 'child has' : 'children have'} not answered`
                    : `All ${children.length} ${children.length === 1 ? 'child is' : 'children are'} cleared`}
              </Text>
              {stats.notSet > 0 && stats.declined > 0 ? (
                <Text style={styles.alertSub}>{stats.notSet} more {stats.notSet === 1 ? 'family has' : 'families have'} not answered yet.</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNumber, { color: colors.success }]}>{stats.allowed}</Text>
              <Text style={styles.summaryLabel}>Allowed</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNumber, { color: colors.danger }]}>{stats.declined}</Text>
              <Text style={styles.summaryLabel}>Declined</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNumber, { color: colors.amber }]}>{stats.notSet}</Text>
              <Text style={styles.summaryLabel}>Not set</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>CHILDREN</Text>
          <View style={styles.card}>
            {children.map((child, index) => {
              const status = child.permissions?.[selectedTab]?.status || 'not_set';
              const allowed = status === 'allowed';
              const declined = status === 'declined';
              return (
                <TouchableOpacity
                  key={child.childId}
                  style={[styles.childRow, index > 0 && styles.childBorder]}
                  onPress={() => navigation.navigate('ChildConsents', { childId: child.childId })}
                  activeOpacity={0.72}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(child.firstName || child.childName || '?').slice(0, 1)}</Text>
                  </View>
                  <Text style={styles.childName}>{child.childName}</Text>
                  <View style={[
                    styles.statusBadge,
                    allowed ? styles.allowedBadge : (declined ? styles.declinedBadge : styles.pendingBadge),
                  ]}>
                    <Ionicons
                      name={allowed ? 'checkmark' : (declined ? 'close' : 'time-outline')}
                      size={14}
                      color={allowed ? colors.success : (declined ? colors.danger : colors.amber)}
                    />
                    <Text style={[
                      styles.statusText,
                      { color: allowed ? colors.success : (declined ? colors.danger : colors.amber) },
                    ]}>
                      {allowed ? 'OK' : (declined ? `No ${selectedMeta.label.toLowerCase()}` : 'Not set')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </TouchableOpacity>
              );
            })}
            {children.length === 0 ? (
              <EmptyState icon="🧒" message="No active children are assigned to this classroom." />
            ) : null}
          </View>

          <Text style={styles.footerNote}>
            Tap a child to review all permissions. Declined and unanswered consent is treated as restricted.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight },
  back: { width: 40, height: 44, justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { textAlign: 'center', fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, textAlign: 'center', fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 52 },
  tabs: { gap: spacing.sm, paddingBottom: spacing.lg },
  tab: { minWidth: 88, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 9, backgroundColor: colors.surface },
  tabActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  tabText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textMuted },
  tabTextActive: { color: colors.white },
  alertCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: 18, backgroundColor: colors.dangerLight },
  allClearCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: 18, backgroundColor: colors.successLight },
  alertCopy: { flex: 1 },
  alertTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.danger },
  allClearTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.success },
  alertSub: { marginTop: 4, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular, color: colors.danger },
  summaryRow: { flexDirection: 'row', marginTop: spacing.lg, paddingVertical: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNumber: { fontSize: 20, fontFamily: fonts.black },
  summaryLabel: { marginTop: 3, fontSize: 11, fontFamily: fonts.regular, color: colors.textMuted },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 11.5, letterSpacing: 0.9, fontFamily: fonts.bold, color: colors.textFaint },
  card: { overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  childRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  childBorder: { borderTopWidth: 1, borderTopColor: colors.primarySoft },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  avatarText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  childName: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  allowedBadge: { backgroundColor: colors.successLight },
  declinedBadge: { backgroundColor: colors.dangerLight },
  pendingBadge: { backgroundColor: colors.amberLight },
  statusText: { fontSize: 10.5, fontFamily: fonts.bold },
  footerNote: { marginTop: spacing.lg, paddingHorizontal: spacing.sm, textAlign: 'center', fontSize: 11.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textFaint },
  retry: { marginTop: spacing.md, padding: spacing.md },
  retryText: { fontFamily: fonts.bold, color: colors.primary },
});
