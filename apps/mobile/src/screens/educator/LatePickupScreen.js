import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLatePickupPreview } from '../../hooks/useRollCall';
import { colors, fonts, radius, spacing } from '../../theme';

function money(cents) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
}

export default function LatePickupScreen({ navigation, route }) {
  const child = route.params?.child;
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    let current = true;
    if (!child?.id) {
      setLoading(false);
      return undefined;
    }
    getLatePickupPreview(child.id)
      .then((data) => current && setPreview(data))
      .catch((error) => current && Alert.alert('Late pickup unavailable', error.message, [
        { text: 'Go back', onPress: () => navigation.goBack() },
      ]))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [child?.id, navigation]);

  function verifyPickup() {
    if (!preview?.canLog) {
      Alert.alert(
        'Still inside the grace period',
        `The center allows ${preview?.graceMinutes || 0} grace minutes. Refresh after that window to log a late pickup.`
      );
      return;
    }
    navigation.navigate('VerifyPickup', {
      pickup: {
        child_id: child.id,
        child_name: child.fullName,
      },
      latePickup: {
        notes: note.trim(),
        preview,
      },
    });
  }

  if (loading || !preview) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loaderPage}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loaderText}>Checking the center pickup policy…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Late pickup</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.alertIcon}>
            <Ionicons name="time-outline" size={31} color={colors.amber} />
          </View>
          <Text style={styles.title}>{child?.firstName || 'Child'} is still here</Text>
          <Text style={styles.subtitle}>
            Confirm the authorized pickup pass before the child leaves. Timing and policy math are calculated by the center record.
          </Text>

          <View style={styles.timingCard}>
            <View style={styles.timingColumn}>
              <Text style={styles.timingLabel}>EXPECTED</Text>
              <Text style={styles.timingValue}>{format(new Date(preview.expectedAt), 'h:mm a')}</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.textFaint} />
            <View style={styles.timingColumn}>
              <Text style={styles.timingLabel}>NOW</Text>
              <Text style={styles.timingValue}>{format(new Date(preview.now), 'h:mm a')}</Text>
            </View>
            <View style={styles.minuteBadge}>
              <Text style={styles.minuteValue}>{preview.lateMinutes}</Text>
              <Text style={styles.minuteLabel}>min late</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Collected by</Text>
          <View style={styles.pickupCard}>
            <View style={styles.pickupIcon}>
              <Ionicons name="shield-checkmark-outline" size={23} color={colors.primary} />
            </View>
            <View style={styles.pickupCopy}>
              <Text style={styles.pickupTitle}>Authorized person on the pass</Text>
              <Text style={styles.pickupText}>
                Expected: {preview.expectedPickupName || 'family pickup'} · the scan records the actual person.
              </Text>
            </View>
            <Ionicons name="qr-code-outline" size={22} color={colors.textFaint} />
          </View>

          <Text style={styles.sectionLabel}>Optional note</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={(value) => setNote(value.slice(0, 500))}
            placeholder="Traffic, family called, office already aware…"
            placeholderTextColor={colors.textFaint}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.policyCard}>
            <View style={styles.policyHeading}>
              <Ionicons name="receipt-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.policyTitle}>Center policy preview</Text>
            </View>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>Grace period</Text>
              <Text style={styles.policyValue}>{preview.graceMinutes} min</Text>
            </View>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>Billable time</Text>
              <Text style={styles.policyValue}>{preview.billableMinutes} min</Text>
            </View>
            <View style={styles.policyRow}>
              <Text style={styles.policyLabel}>
                {preview.conversationRequired ? 'Follow-up' : 'Estimated fee'}
              </Text>
              <Text style={[styles.policyValue, preview.conversationRequired && styles.conversationValue]}>
                {preview.conversationRequired ? 'Conversation required' : money(preview.feeCents)}
              </Text>
            </View>
            <Text style={styles.policyNote}>
              Final minutes use the verified check-out time. The office sees this record immediately; billing can apply it to the next invoice.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.verifyButton, !preview.canLog && styles.disabled]}
            onPress={verifyPickup}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.white} />
            <Text style={styles.verifyButtonText}>Verify pass & log pickup</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  loaderPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loaderText: { marginTop: spacing.md, color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
  header: {
    minHeight: 66, flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    paddingHorizontal: spacing.lg, backgroundColor: colors.surface,
  },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  headerSpacer: { width: 32 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  alertIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.amberLight },
  title: { marginTop: spacing.md, color: colors.textPrimary, fontSize: 25, fontFamily: fonts.black },
  subtitle: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13.5, lineHeight: 20, fontFamily: fonts.regular },
  timingCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl,
    padding: spacing.lg, borderWidth: 1.5, borderColor: '#E9C98E',
    borderRadius: radius.xl, backgroundColor: colors.amberLight,
  },
  timingColumn: { flex: 1 },
  timingLabel: { color: colors.textFaint, fontSize: 9.5, letterSpacing: 1, fontFamily: fonts.bold },
  timingValue: { marginTop: 3, color: colors.textPrimary, fontSize: 18, fontFamily: fonts.black },
  minuteBadge: { alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  minuteValue: { color: colors.amber, fontSize: 19, fontFamily: fonts.black },
  minuteLabel: { color: colors.amber, fontSize: 9.5, fontFamily: fonts.bold },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  pickupCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  pickupIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.primaryLight },
  pickupCopy: { flex: 1 },
  pickupTitle: { color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  pickupText: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular },
  noteInput: { minHeight: 96, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  policyCard: { marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface },
  policyHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  policyTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  policyLabel: { color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.regular },
  policyValue: { color: colors.textPrimary, fontSize: 12.5, fontFamily: fonts.bold },
  conversationValue: { color: colors.amber },
  policyNote: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft, color: colors.textFaint, fontSize: 11, lineHeight: 16, fontFamily: fonts.regular },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  verifyButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  verifyButtonText: { color: colors.white, fontSize: 15.5, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },
});
