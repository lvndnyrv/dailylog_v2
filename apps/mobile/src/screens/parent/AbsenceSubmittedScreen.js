import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { colors, fonts, radius, spacing } from '../../theme';

function dateSummary(result) {
  if (!result?.startsOn) return 'The selected dates';
  const start = parseISO(`${result.startsOn}T12:00:00`);
  if (!result.endsOn || result.endsOn === result.startsOn) return format(start, 'EEEE, MMMM d');
  const end = parseISO(`${result.endsOn}T12:00:00`);
  return `${format(start, 'MMM d')}–${format(end, 'MMM d, yyyy')}`;
}

export default function AbsenceSubmittedScreen({ navigation, route }) {
  const child = route.params?.child;
  const result = route.params?.result;
  const updated = result?.action === 'updated';
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={42} color={colors.success} /></View>
        <Text style={styles.title}>{updated ? 'Absence updated' : 'Absence reported'}</Text>
        <Text style={styles.body}>
          {dateSummary(result)} is now marked absent for {child?.first_name || 'your child'}.
        </Text>
        <View style={styles.confirmCard}>
          <View style={styles.confirmRow}>
            <Ionicons name="people-outline" size={20} color={colors.primary} />
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmTitle}>The center was notified</Text>
              <Text style={styles.confirmText}>The office and classroom educators can see the update right away.</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.confirmRow}>
            <Ionicons name="receipt-outline" size={20} color={colors.textMuted} />
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmTitle}>Billing is unchanged</Text>
              <Text style={styles.confirmText}>Your center’s regular attendance and billing policy still applies.</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.replace('ReportAbsence', { child })}>
          <Text style={styles.secondaryText}>Manage absences</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('ParentTabs', { screen: 'ParentHome', params: { childId: child?.id } })}>
          <Text style={styles.primaryText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  successIcon: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center', borderRadius: 46, backgroundColor: colors.successLight },
  title: { marginTop: spacing.xl, color: colors.textPrimary, fontSize: 26, textAlign: 'center', fontFamily: fonts.black },
  body: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', fontFamily: fonts.regular },
  confirmCard: { alignSelf: 'stretch', marginTop: spacing.xxxl, paddingHorizontal: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  confirmRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.lg },
  confirmCopy: { flex: 1 },
  confirmTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  confirmText: { marginTop: 3, color: colors.textMuted, fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
  divider: { height: 1, backgroundColor: colors.borderSoft },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  secondaryButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryText: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  primaryButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  primaryText: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
});
