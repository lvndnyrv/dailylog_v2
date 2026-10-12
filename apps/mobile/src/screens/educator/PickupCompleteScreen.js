import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { colors, fonts, radius, spacing } from '../../theme';

export default function PickupCompleteScreen({ navigation, route }) {
  const result = route.params?.result || {};
  const latePickup = route.params?.latePickup || Boolean(result.late_pickup_event_id);
  const checkoutTime = result.checked_out_at
    ? format(new Date(result.checked_out_at), 'h:mm a')
    : 'just now';

  function backToPickups() {
    navigation.popTo(latePickup ? 'RollCall' : 'Pickups');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.successRing}>
          <Ionicons name="checkmark" size={54} color={colors.white} />
        </View>
        <Text style={styles.eyebrow}>CHECKED OUT</Text>
        <Text style={styles.title}>{result.child_name || 'Child'} is on the way home</Text>
        <Text style={styles.subtitle}>
          Released to {result.presenter_name || 'the authorized pickup'}
          {result.relationship ? ` · ${result.relationship}` : ''} at {checkoutTime}.
        </Text>

        <View style={styles.noticeCard}>
          <Ionicons name="notifications-outline" size={23} color={colors.primary} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Family notified</Text>
            <Text style={styles.noticeText}>
              The check-out was signed, time-stamped, and sent to linked parents.
            </Text>
          </View>
        </View>

        {latePickup && (
          <View style={styles.lateCard}>
            <Ionicons name="receipt-outline" size={23} color={colors.amber} />
            <View style={styles.noticeCopy}>
              <Text style={styles.lateTitle}>Late pickup recorded</Text>
              <Text style={styles.noticeText}>
                {result.late_minutes || 0} minutes late · {result.billable_minutes || 0} billable · {' '}
                {result.conversation_required
                  ? 'office follow-up required'
                  : `${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((result.fee_cents || 0) / 100)} policy fee`}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.primaryButton} onPress={backToPickups}>
          <Text style={styles.primaryButtonText}>
            {latePickup ? 'Back to attendance' : 'Back to pickups'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  successRing: {
    width: 104, height: 104, alignItems: 'center', justifyContent: 'center',
    borderRadius: 52, backgroundColor: colors.success,
    shadowColor: colors.success, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 5,
  },
  eyebrow: {
    marginTop: spacing.xl, color: colors.success, fontSize: 11,
    letterSpacing: 1.7, fontFamily: fonts.bold,
  },
  title: {
    marginTop: spacing.sm, maxWidth: 330, textAlign: 'center',
    color: colors.textPrimary, fontSize: 26, lineHeight: 32, fontFamily: fonts.black,
  },
  subtitle: {
    marginTop: spacing.sm, maxWidth: 320, textAlign: 'center',
    color: colors.textMuted, fontSize: 14, lineHeight: 21, fontFamily: fonts.regular,
  },
  noticeCard: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.xl, padding: spacing.lg, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  noticeText: {
    marginTop: 2, color: colors.textMuted, fontSize: 12.5,
    lineHeight: 18, fontFamily: fonts.regular,
  },
  lateCard: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.md, padding: spacing.lg, borderWidth: 1.5,
    borderColor: '#E9C98E', borderRadius: radius.xl, backgroundColor: colors.amberLight,
  },
  lateTitle: { color: colors.amber, fontSize: 14, fontFamily: fonts.bold },
  primaryButton: {
    alignSelf: 'stretch', minHeight: 54, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
});
