import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, spacing } from '../../theme';

export default function RollCallCompleteScreen({ navigation, route }) {
  const result = route.params?.result || {};
  const classroomName = route.params?.classroomName || 'Classroom';

  function review() {
    navigation.replace('RollCall');
  }

  function backToRoster() {
    navigation.popTo('EducatorTabs', { screen: 'Roster' });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.successRing}>
          <Ionicons name="checkmark" size={54} color={colors.white} />
        </View>
        <Text style={styles.eyebrow}>ROLL CALL SAVED</Text>
        <Text style={styles.title}>{classroomName} is accounted for</Text>
        <Text style={styles.subtitle}>
          Saved at {result.completedAt ? format(new Date(result.completedAt), 'h:mm a') : 'just now'}. Kiosk and family updates will continue syncing after completion.
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, styles.present]}>{result.present || 0}</Text>
            <Text style={styles.summaryLabel}>In</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, styles.absent]}>{result.absent || 0}</Text>
            <Text style={styles.summaryLabel}>Absent</Text>
          </View>
          <View style={styles.separator} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, styles.awaited]}>{result.awaited || 0}</Text>
            <Text style={styles.summaryLabel}>Awaited</Text>
          </View>
        </View>

        {Number(result.awaited || 0) > 0 && (
          <View style={styles.followUpCard}>
            <Ionicons name="notifications-outline" size={22} color={colors.amber} />
            <View style={styles.followUpCopy}>
              <Text style={styles.followUpTitle}>Follow-up remains visible</Text>
              <Text style={styles.followUpText}>
                {result.awaited} {Number(result.awaited) === 1 ? 'family is' : 'families are'} still awaited. You can reopen attendance at any time.
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.primaryButton} onPress={backToRoster}>
          <Text style={styles.primaryButtonText}>Back to classroom</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={review}>
          <Text style={styles.secondaryButtonText}>Review attendance</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  successRing: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', borderRadius: 52, backgroundColor: colors.success, shadowColor: colors.success, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 5 },
  eyebrow: { marginTop: spacing.xl, color: colors.success, fontSize: 11, letterSpacing: 1.7, fontFamily: fonts.bold },
  title: { marginTop: spacing.sm, maxWidth: 330, textAlign: 'center', color: colors.textPrimary, fontSize: 26, lineHeight: 32, fontFamily: fonts.black },
  subtitle: { marginTop: spacing.sm, maxWidth: 330, textAlign: 'center', color: colors.textMuted, fontSize: 13.5, lineHeight: 20, fontFamily: fonts.regular },
  summaryCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, paddingVertical: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 24, fontFamily: fonts.black },
  present: { color: colors.success },
  absent: { color: colors.amber },
  awaited: { color: colors.primary },
  summaryLabel: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.bold },
  separator: { width: 1, height: 34, backgroundColor: colors.borderSoft },
  followUpCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: '#E9C98E', borderRadius: radius.lg, backgroundColor: colors.amberLight },
  followUpCopy: { flex: 1 },
  followUpTitle: { color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold },
  followUpText: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  primaryButton: { alignSelf: 'stretch', minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary },
  primaryButtonText: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  secondaryButton: { alignSelf: 'stretch', minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryButtonText: { color: colors.primary, fontSize: 14.5, fontFamily: fonts.bold },
});
