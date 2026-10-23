import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useParentBilling } from '../../hooks/useParentBilling';
import { exportBillingStatementPdf } from '../../lib/export';
import { colors, fonts, radius, spacing } from '../../theme';
import { money, monthLabel, ScreenHeader, sharedStyles } from './ParentBillingShared';

export default function ParentStatementsScreen({ navigation }) {
  const { home, loading, error, refresh } = useParentBilling();
  const [exporting, setExporting] = useState('');

  useFocusEffect(useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]));

  async function share(statement) {
    setExporting(statement.id);
    try {
      await exportBillingStatementPdf({
        familyName: home.family_name,
        daycareName: home.daycare_name,
        billingEmail: home.billing_email,
        statement,
      });
    } catch (shareError) {
      Alert.alert('Could not prepare PDF', shareError.message || 'Please try again.');
    } finally {
      setExporting('');
    }
  }

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScreenHeader navigation={navigation} title="Statements & tax" />
      {!home && loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : null}
      {error && !home ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={() => refresh().catch(() => {})}><Text style={styles.retry}>Try again</Text></TouchableOpacity>
        </View>
      ) : null}
      {home ? (
        <ScrollView contentContainerStyle={sharedStyles.content}>
          <View style={styles.taxUnavailableCard}>
            <View style={styles.taxUnavailableIcon}><Ionicons name="time-outline" size={21} color={colors.amber} /></View>
            <View style={styles.taxCopy}>
              <Text style={styles.taxTitle}>Annual tuition statement not published</Text>
              <Text style={styles.taxUnavailableText}>Your center will review each child’s payments and share a year-end statement here when it is ready. Monthly statements below are still available.</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Monthly statements</Text>
          <View style={styles.statementList}>
            {(home.statements || []).map((statement) => (
              <TouchableOpacity
                key={statement.id}
                style={styles.statementRow}
                disabled={Boolean(exporting)}
                onPress={() => share(statement)}
              >
                <View style={styles.statementIcon}><Ionicons name="document-outline" size={18} color={colors.textFaint} /></View>
                <View style={styles.statementCopy}>
                  <Text style={styles.statementTitle}>{monthLabel(statement.period_start)}</Text>
                  <Text style={styles.statementAmount}>{money(statement.total_cents)}</Text>
                </View>
                <Text style={styles.pdfLabel}>PDF</Text>
                {exporting === statement.id ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="download-outline" size={19} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>

          {!(home.statements || []).length ? (
            <View style={styles.emptyCard}>
              <Ionicons name="folder-open-outline" size={28} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No monthly statements yet</Text>
            </View>
          ) : null}

          <Text style={styles.footerNote}>Monthly statement PDFs are generated from your family billing record and opened in the share sheet. They are not annual tuition or tax statements.</Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  error: { color: colors.danger, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  retry: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14, marginTop: spacing.md },
  taxCopy: { flex: 1, minWidth: 0 },
  taxTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  taxUnavailableCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.amberLight, borderWidth: 1.5, borderColor: 'rgba(176,120,43,0.2)', borderRadius: 16, padding: spacing.lg, marginTop: spacing.sm },
  taxUnavailableIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  taxUnavailableText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginTop: spacing.lg, marginBottom: spacing.md },
  statementList: { gap: 9 },
  statementRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 62, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: radius.lg },
  statementIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  statementCopy: { flex: 1 },
  statementTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  statementAmount: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  pdfLabel: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12.5 },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14, marginTop: spacing.sm },
  footerNote: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 18, textAlign: 'center', marginTop: spacing.lg },
});
