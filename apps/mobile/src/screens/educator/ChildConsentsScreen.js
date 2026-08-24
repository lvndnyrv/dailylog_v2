import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { getChildConsents } from '../../hooks/useStaffVisibility';
import { EmptyState } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

const STATUS = {
  allowed: { label: 'Allowed', icon: 'checkmark-circle', color: colors.success, bg: colors.successLight },
  declined: { label: 'Declined', icon: 'close-circle', color: colors.danger, bg: colors.dangerLight },
  not_set: { label: 'Not set', icon: 'help-circle', color: colors.amber, bg: colors.amberLight },
};

export default function ChildConsentsScreen({ navigation, route }) {
  const child = route.params?.child;
  const childId = route.params?.childId || child?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!childId) {
      setError('This child could not be identified.');
      setLoading(false);
      return;
    }
    setError('');
    try {
      setData(await getChildConsents(childId));
    } catch (loadError) {
      setError(loadError.message || 'Consent records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = data?.items || [];
  const restricted = items.filter((item) => item.status !== 'allowed');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Child consents</Text>
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
          <View style={styles.childHero}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(data?.childName || child?.first_name || '?').slice(0, 1)}</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.childName}>{data?.childName || `${child?.first_name || ''} ${child?.last_name || ''}`.trim()}</Text>
              <Text style={styles.heroSubtitle}>Parent-controlled permissions</Text>
            </View>
            <View style={[styles.restrictionCount, restricted.length === 0 && styles.restrictionCountGood]}>
              <Text style={[styles.restrictionNumber, restricted.length === 0 && styles.restrictionNumberGood]}>{restricted.length}</Text>
              <Text style={[styles.restrictionLabel, restricted.length === 0 && styles.restrictionLabelGood]}>
                {restricted.length === 1 ? 'restriction' : 'restrictions'}
              </Text>
            </View>
          </View>

          {restricted.length > 0 ? (
            <View style={styles.alertCard}>
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.danger} />
              <Text style={styles.alertText}>
                Declined and unanswered permissions are enforced across supported educator workflows. Photo uploads are blocked automatically.
              </Text>
            </View>
          ) : (
            <View style={styles.goodCard}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.goodText}>All tracked activities are currently allowed.</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>CURRENT PERMISSIONS</Text>
          <View style={styles.card}>
            {items.map((item, index) => {
              const meta = STATUS[item.status] || STATUS.not_set;
              return (
                <View key={item.kind} style={[styles.consentRow, index > 0 && styles.rowBorder]}>
                  <View style={[styles.statusIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                  <View style={styles.consentCopy}>
                    <Text style={styles.consentLabel}>{item.label}</Text>
                    <Text style={styles.consentDetail}>{item.detail}</Text>
                    {item.updatedAt ? (
                      <Text style={styles.updatedText}>
                        Updated {format(new Date(item.updatedAt), 'MMM d, yyyy')}
                        {item.updatedBy ? ` by ${item.updatedBy}` : ''}
                      </Text>
                    ) : (
                      <Text style={styles.updatedText}>No family response yet</Text>
                    )}
                  </View>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.parentNote}>
            <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
            <Text style={styles.parentNoteText}>
              Families manage these permissions from their app. Staff cannot override a declined consent.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight,
  },
  back: { width: 40, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 52 },
  childHero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 20, backgroundColor: colors.surface,
  },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  avatarText: { fontSize: 19, fontFamily: fonts.bold, color: colors.primary },
  heroCopy: { flex: 1, minWidth: 0 },
  childName: { fontSize: 17, fontFamily: fonts.black, color: colors.textPrimary },
  heroSubtitle: { marginTop: 3, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted },
  restrictionCount: { alignItems: 'center', borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.dangerLight },
  restrictionCountGood: { backgroundColor: colors.successLight },
  restrictionNumber: { fontSize: 18, fontFamily: fonts.black, color: colors.danger },
  restrictionNumberGood: { color: colors.success },
  restrictionLabel: { fontSize: 9.5, fontFamily: fonts.bold, color: colors.danger },
  restrictionLabelGood: { color: colors.success },
  alertCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg,
    padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight,
  },
  alertText: { flex: 1, fontSize: 12.5, lineHeight: 19, fontFamily: fonts.regular, color: colors.danger },
  goodCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.successLight },
  goodText: { flex: 1, fontSize: 13, fontFamily: fonts.bold, color: colors.success },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 11.5, letterSpacing: 0.9, fontFamily: fonts.bold, color: colors.textFaint },
  card: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.primarySoft },
  statusIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  consentCopy: { flex: 1, minWidth: 0 },
  consentLabel: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  consentDetail: { marginTop: 4, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  updatedText: { marginTop: 5, fontSize: 10.5, fontFamily: fonts.regular, color: colors.textFaint },
  badge: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 10.5, fontFamily: fonts.bold },
  parentNote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  parentNoteText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  retry: { marginTop: spacing.md, padding: spacing.md },
  retryText: { fontFamily: fonts.bold, color: colors.primary },
});
