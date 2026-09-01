import React, { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reportUnauthorizedPickup } from '../../hooks/usePickupVerification';
import { colors, fonts, radius, spacing } from '../../theme';

export default function UnauthorizedPickupScreen({ navigation, route }) {
  const pickup = route.params?.pickup || {};
  const [attemptedName, setAttemptedName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState(null);

  function callGuardian() {
    if (pickup.primary_guardian_phone) {
      Linking.openURL(`tel:${pickup.primary_guardian_phone.replace(/[^+\d]/g, '')}`);
    }
  }

  async function notifyDirector() {
    if (!pickup.child_id || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportUnauthorizedPickup(pickup.child_id, attemptedName, notes);
      setNotified(true);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (notified) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.confirmedPage}>
          <View style={styles.confirmedIcon}>
            <Ionicons name="notifications" size={42} color={colors.danger} />
          </View>
          <Text style={styles.confirmedTitle}>Director notified</Text>
          <Text style={styles.confirmedText}>
            Keep {pickup.child_name || 'the child'} with staff. No check-out was recorded,
            and the attempt is now in the center’s safety log.
          </Text>
          {pickup.primary_guardian_phone && (
            <TouchableOpacity style={styles.outlineButton} onPress={callGuardian}>
              <Ionicons name="call-outline" size={19} color={colors.primary} />
              <Text style={styles.outlineButtonText}>Call primary guardian</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.popTo('Pickups')}>
            <Text style={styles.primaryButtonText}>Back to pickups</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back to pickup verification"
        >
          <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pickup safety</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.warningIcon}>
          <Ionicons name="close" size={38} color={colors.danger} />
        </View>
        <Text style={styles.eyebrow}>NOT ON AUTHORIZED LIST</Text>
        <Text style={styles.title}>Do not release {pickup.child_name || 'this child'}</Text>
        <Text style={styles.subtitle}>
          Keep the child with staff while you call the primary guardian and notify a director.
        </Text>

        <View style={styles.guardianCard}>
          <Ionicons name="person-circle-outline" size={30} color={colors.primary} />
          <View style={styles.guardianCopy}>
            <Text style={styles.guardianLabel}>Primary guardian</Text>
            <Text style={styles.guardianName}>
              {pickup.primary_guardian_name || 'Contact saved on the child profile'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.callButton, !pickup.primary_guardian_phone && styles.disabled]}
            onPress={callGuardian}
            disabled={!pickup.primary_guardian_phone}
          >
            <Ionicons name="call" size={17} color={colors.white} />
          </TouchableOpacity>
        </View>

        <Text style={styles.inputLabel}>Person’s name (if known)</Text>
        <TextInput
          style={styles.input}
          value={attemptedName}
          onChangeText={setAttemptedName}
          placeholder="e.g. Alex Martin"
          placeholderTextColor={colors.textFaint}
          maxLength={120}
        />
        <Text style={styles.inputLabel}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="What did the person say or present?"
          placeholderTextColor={colors.textFaint}
          maxLength={1000}
          multiline
          textAlignVertical="top"
        />
        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.dangerButton, submitting && styles.disabled]}
          onPress={notifyDirector}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={colors.white} />
            : <>
              <Ionicons name="notifications" size={19} color={colors.white} />
              <Text style={styles.dangerButtonText}>Notify director now</Text>
            </>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.primarySoft,
  },
  headerTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  content: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  warningIcon: {
    width: 82, height: 82, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.lg, borderRadius: 41, backgroundColor: colors.dangerLight,
  },
  eyebrow: {
    marginTop: spacing.lg, color: colors.danger, fontSize: 10.5,
    letterSpacing: 1.3, fontFamily: fonts.bold,
  },
  title: {
    marginTop: spacing.sm, maxWidth: 330, textAlign: 'center',
    color: colors.textPrimary, fontSize: 25, lineHeight: 31, fontFamily: fonts.black,
  },
  subtitle: {
    marginTop: spacing.sm, maxWidth: 330, textAlign: 'center',
    color: colors.textMuted, fontSize: 13.5, lineHeight: 20, fontFamily: fonts.regular,
  },
  guardianCard: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.xl, padding: spacing.md, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  guardianCopy: { flex: 1, minWidth: 0 },
  guardianLabel: { color: colors.textFaint, fontSize: 10.5, fontFamily: fonts.bold },
  guardianName: { marginTop: 2, color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  callButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  inputLabel: {
    alignSelf: 'stretch', marginTop: spacing.lg, marginBottom: spacing.sm,
    color: colors.textPrimary, fontSize: 13, fontFamily: fonts.bold,
  },
  input: {
    alignSelf: 'stretch', minHeight: 50, paddingHorizontal: spacing.md,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface, color: colors.textPrimary,
    fontSize: 14, fontFamily: fonts.regular,
  },
  notesInput: { minHeight: 84, paddingTop: spacing.md },
  errorText: {
    marginTop: spacing.md, color: colors.danger, textAlign: 'center',
    fontSize: 12.5, fontFamily: fonts.bold,
  },
  dangerButton: {
    alignSelf: 'stretch', minHeight: 54, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl,
    borderRadius: radius.md, backgroundColor: colors.danger,
  },
  dangerButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  cancelButton: { marginTop: spacing.md, padding: spacing.md },
  cancelButtonText: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.48 },
  confirmedPage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  confirmedIcon: {
    width: 88, height: 88, alignItems: 'center', justifyContent: 'center',
    borderRadius: 44, backgroundColor: colors.dangerLight,
  },
  confirmedTitle: { marginTop: spacing.lg, fontSize: 25, fontFamily: fonts.black, color: colors.textPrimary },
  confirmedText: {
    marginTop: spacing.sm, maxWidth: 330, textAlign: 'center',
    color: colors.textMuted, fontSize: 14, lineHeight: 21, fontFamily: fonts.regular,
  },
  outlineButton: {
    alignSelf: 'stretch', minHeight: 50, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl,
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
  },
  outlineButtonText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
  primaryButton: {
    alignSelf: 'stretch', minHeight: 54, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
});
