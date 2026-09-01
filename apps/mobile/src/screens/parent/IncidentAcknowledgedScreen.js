import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { colors, fonts, radius, spacing } from '../../theme';

export default function IncidentAcknowledgedScreen({ navigation, route }) {
  const child = route.params?.child;
  const result = route.params?.result;
  const acknowledgedAt = result?.acknowledgedAt ? new Date(result.acknowledgedAt) : new Date();
  const directorReviewPending = Boolean(result?.directorReviewPending);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.icon}><Ionicons name="checkmark" size={42} color={colors.success} /></View>
        <Text style={styles.title}>Thank you</Text>
        <Text style={styles.body}>
          Your acknowledgment was sent to the center and recorded at {format(acknowledgedAt, 'h:mm a')}.
        </Text>
        <View style={styles.signedCard}>
          <Text style={styles.signedLabel}>SIGNED</Text>
          <Text style={styles.signedName}>{result?.signedName || 'Parent'}</Text>
          <Text style={styles.signedMeta}>Parent · {format(acknowledgedAt, 'MMMM d, yyyy')}</Text>
        </View>
        <View style={styles.receiptNote}>
          <Ionicons name={directorReviewPending ? 'time-outline' : 'shield-checkmark-outline'} size={18} color={directorReviewPending ? colors.amber : colors.success} />
          <Text style={styles.receiptText}>
            {directorReviewPending
              ? `Your acknowledgment is saved. The director is still reviewing ${child?.first_name || 'your child'}’s report.`
              : `This receipt remains available in ${child?.first_name || 'your child'}’s incident report history.`}
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondary} onPress={() => navigation.replace('ParentIncidents', { child, childId: child?.id })}>
          <Text style={styles.secondaryText}>View reports</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate('ParentTabs', { screen: 'ParentHome', params: { childId: child?.id } })}>
          <Text style={styles.primaryText}>Back to Today</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  icon: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 44, backgroundColor: colors.successLight },
  title: { marginTop: spacing.xl, color: colors.textPrimary, fontSize: 25, fontFamily: fonts.black },
  body: { marginTop: spacing.sm, maxWidth: 300, color: colors.textMuted, fontSize: 14.5, lineHeight: 22, textAlign: 'center', fontFamily: fonts.regular },
  signedCard: { alignSelf: 'stretch', alignItems: 'center', marginTop: spacing.xxxl, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  signedLabel: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 1.2, fontFamily: fonts.bold },
  signedName: { marginTop: 5, color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  signedMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  receiptNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  receiptText: { flex: 1, color: colors.textMuted, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  secondary: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryText: { color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  primary: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  primaryText: { color: colors.white, fontSize: 13.5, fontFamily: fonts.bold },
});
