import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function dateLabel(value) {
  const date = value ? parseISO(value) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, 'MMM d, yyyy') : 'No expiry';
}

export default function AdminComplianceScreen({ navigation }) {
  const [dueItems, setDueItems] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [dueResult, documentsResult] = await Promise.all([
      supabase.rpc('list_compliance_due_items'),
      supabase.from('compliance_documents').select('id, title, category, expires_on, version, watch_expiry, include_in_inspection').order('created_at', { ascending: false }),
    ]);
    setDueItems(dueResult.data || []);
    setDocuments(documentsResult.data || []);
    setError(dueResult.error?.message || documentsResult.error?.message || '');
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const currentDocuments = useMemo(() => {
    const seen = new Set();
    return documents.filter(document => {
      const key = `${document.title}:${document.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [documents]);

  if (loading && !dueItems.length && !documents.length) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.title}>Compliance</Text><Text style={styles.subtitle}>Deadlines and center records</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}>
        {error ? <TouchableOpacity style={styles.errorCard} onPress={() => load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></TouchableOpacity> : null}
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark-outline" size={24} color={dueItems.length ? colors.amber : colors.success} /></View>
          <View style={styles.flex}><Text style={styles.heroTitle}>{dueItems.length ? `${dueItems.length} item${dueItems.length === 1 ? '' : 's'} need attention` : 'No upcoming compliance deadlines'}</Text><Text style={styles.heroText}>Review center records here, then open the live inspection pack to print or share a minimized PDF.</Text></View>
        </View>

        <TouchableOpacity
          style={styles.packButton}
          onPress={() => navigation.navigate('AdminInspectionPack')}
          accessibilityRole="button"
          accessibilityLabel="Open inspection pack"
        >
          <View style={styles.packIcon}><Ionicons name="documents-outline" size={21} color={colors.primary} /></View>
          <View style={styles.flex}><Text style={styles.packTitle}>Inspection pack</Text><Text style={styles.packDetail}>Preview the live register · print or share PDF</Text></View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Due and expiring</Text>
        <View style={styles.card}>
          {!dueItems.length ? <Text style={styles.emptyText}>Nothing is currently due.</Text> : dueItems.map((item, index) => {
            const overdue = Number(item.days_left) < 0;
            return (
              <View key={`${item.kind}:${item.id}`} style={[styles.row, index < dueItems.length - 1 && styles.rowBorder]}>
                <View style={[styles.rowIcon, { backgroundColor: overdue ? colors.dangerLight : colors.amberLight }]}><Ionicons name={overdue ? 'alert-circle-outline' : 'time-outline'} size={19} color={overdue ? colors.danger : colors.amber} /></View>
                <View style={styles.flex}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowDetail}>{dateLabel(item.due_on)} · {item.kind.replaceAll('_', ' ')}</Text></View>
                <Text style={[styles.days, overdue && styles.daysDanger]}>{overdue ? `${Math.abs(item.days_left)}d late` : item.days_left === 0 ? 'Today' : `${item.days_left}d`}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Document vault</Text>
        <View style={styles.card}>
          {!currentDocuments.length ? <Text style={styles.emptyText}>No center documents are on file yet.</Text> : currentDocuments.map((document, index) => (
            <View key={document.id} style={[styles.row, index < currentDocuments.length - 1 && styles.rowBorder]}>
              <View style={[styles.rowIcon, { backgroundColor: colors.primaryLight }]}><Ionicons name="document-text-outline" size={19} color={colors.primary} /></View>
              <View style={styles.flex}><Text style={styles.rowTitle}>{document.title}</Text><Text style={styles.rowDetail}>{document.category.replaceAll('_', ' ')} · v{document.version} · {dateLabel(document.expires_on)}</Text></View>
              {document.include_in_inspection ? <Ionicons name="checkmark-circle" size={19} color={colors.success} /> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }, flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 20 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 }, subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { padding: spacing.xl, paddingBottom: 44 },
  heroCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  heroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  heroTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 }, heroText: { marginTop: 4, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  packButton: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl, padding: spacing.md, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.lg, backgroundColor: colors.surface },
  packIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primaryLight },
  packTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14 },
  packDetail: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  sectionTitle: { marginBottom: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  card: { overflow: 'hidden', marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }, rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md }, rowTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 }, rowDetail: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5, textTransform: 'capitalize' },
  days: { color: colors.amber, fontFamily: fonts.bold, fontSize: 11 }, daysDanger: { color: colors.danger }, emptyText: { padding: spacing.lg, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  errorCard: { padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight }, errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
});
