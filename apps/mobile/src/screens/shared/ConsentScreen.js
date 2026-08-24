import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

const CONSENT_VERSION = '2026-08-20';
const COLLECTED_ITEMS = [
  { icon: 'happy-outline', label: 'Daily mood and general wellbeing' },
  { icon: 'restaurant-outline', label: 'Meal times and food eaten' },
  { icon: 'water-outline', label: 'Diaper and toilet activity' },
  { icon: 'moon-outline', label: 'Nap times' },
  { icon: 'grid-outline', label: 'Activities completed' },
  { icon: 'cube-outline', label: 'Supply requests from your educator' },
  { icon: 'create-outline', label: 'Notes and comments from the educator' },
];

export default function ConsentScreen({ childId, childName, onDone }) {
  const { signOut } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [error, setError] = useState('');

  async function saveDecision(granted) {
    setLoading(true);
    setError('');
    const { error: consentError } = await supabase.rpc(
      'set_parent_care_data_consent',
      {
        p_child_id: childId,
        p_granted: granted,
        p_version: CONSENT_VERSION,
      }
    );
    setLoading(false);
    if (consentError) {
      setError(consentError.message || 'Your choice could not be saved. Please try again.');
      return false;
    }
    return true;
  }

  async function handleConsent() {
    if (!agreed || loading) return;
    if (await saveDecision(true)) onDone();
  }

  async function handleDecline() {
    if (loading) return;
    if (!(await saveDecision(false))) {
      setDeclineOpen(false);
      return;
    }
    await signOut();
  }

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={() => {}}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="lock-closed-outline" size={29} color={colors.primary} />
            </View>
            <Text style={styles.title}>Before you continue</Text>
            <Text style={styles.subtitle}>
              Your daycare uses DailyLog to share daily updates about{' '}
              <Text style={styles.strong}>{childName}</Text> with you.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>WHAT WE COLLECT</Text>
            {COLLECTED_ITEMS.map((item) => (
              <View key={item.label} style={styles.dataRow}>
                <View style={styles.dataIcon}>
                  <Ionicons name={item.icon} size={17} color={colors.primary} />
                </View>
                <Text style={styles.dataText}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>HOW IT'S USED</Text>
            <Text style={styles.bodyText}>
              This information is only shared between your daycare's educators
              and the parents or guardians linked to your child. It is never
              sold, shared with advertisers, or used for anything other than
              keeping you informed about your child's day.
            </Text>
            <Text style={[styles.bodyText, styles.bodyParagraph]}>
              You can request deletion of all data at any time from Settings.
            </Text>
          </View>

          {error ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => {
              setAgreed((value) => !value);
              setError('');
            }}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
            </View>
            <Text style={styles.checkLabel}>
              I consent to DailyLog collecting and sharing daily care
              information about <Text style={styles.strong}>{childName}</Text>{' '}
              as described above.
            </Text>
          </TouchableOpacity>

          <Button
            label="Continue"
            onPress={handleConsent}
            loading={loading && !declineOpen}
            disabled={!agreed || loading}
            style={styles.button}
          />

          {!agreed ? (
            <Text style={styles.hint}>Check the box above to continue.</Text>
          ) : (
            <TouchableOpacity
              onPress={() => setDeclineOpen(true)}
              style={styles.declineLink}
              accessibilityRole="button"
            >
              <Text style={styles.declineLinkText}>I don't consent</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <Modal
          visible={declineOpen}
          transparent
          animationType="slide"
          onRequestClose={() => !loading && setDeclineOpen(false)}
        >
          <View style={styles.declineOverlay}>
            <TouchableOpacity
              style={styles.declineBackdrop}
              activeOpacity={1}
              onPress={() => !loading && setDeclineOpen(false)}
              accessibilityLabel="Go back"
            />
            <View style={styles.declineSheet}>
              <View style={styles.grabber} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Decline consent?</Text>
                <TouchableOpacity
                  onPress={() => !loading && setDeclineOpen(false)}
                  style={styles.closeButton}
                  accessibilityLabel="Close decline confirmation"
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.sheetBody}>
                {childName}'s educators will still care for them and keep the
                daycare's own records—but nothing will be shared with you in DailyLog.
              </Text>

              <View style={styles.consequenceCard}>
                <Consequence icon="close" danger text="No daily reports, photos or notes" />
                <Consequence icon="close" danger text={`No chat with ${childName}'s educators`} />
                <Consequence
                  icon="checkmark"
                  text="Your daycare is notified so they can follow up in person"
                />
              </View>

              <View style={styles.reconsiderCard}>
                <Text style={styles.reconsiderText}>
                  You can change your mind anytime—this screen will be shown
                  again next time you open DailyLog.
                </Text>
              </View>

              {error ? <Text style={styles.sheetError}>{error}</Text> : null}

              <Button
                label="Go back"
                onPress={() => setDeclineOpen(false)}
                disabled={loading}
              />
              <TouchableOpacity
                style={styles.declineConfirm}
                onPress={handleDecline}
                disabled={loading}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.declineConfirmText}>Decline and sign out</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

function Consequence({ icon, danger = false, text }) {
  return (
    <View style={styles.consequenceRow}>
      <View style={[styles.consequenceIcon, danger && styles.consequenceIconDanger]}>
        <Ionicons
          name={icon}
          size={14}
          color={danger ? colors.danger : colors.success}
        />
      </View>
      <Text style={styles.consequenceText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xxl, paddingTop: 52, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  heroIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: spacing.md },
  title: { fontSize: 25, lineHeight: 31, fontFamily: fonts.black, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { maxWidth: 310, marginTop: spacing.sm, fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: colors.textMuted, textAlign: 'center' },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  card: { width: '100%', padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  cardTitle: { marginBottom: spacing.md, fontSize: 12, letterSpacing: 1.05, fontFamily: fonts.bold, color: colors.textFaint },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 13 },
  dataIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  dataText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.textSecondary },
  bodyText: { fontSize: 13.5, lineHeight: 21, fontFamily: fonts.regular, color: colors.textSecondary },
  bodyParagraph: { marginTop: spacing.sm },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginTop: spacing.xs, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.danger },
  checkRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: 2, marginVertical: spacing.lg },
  checkbox: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: colors.textSecondary },
  button: { width: '100%' },
  hint: { marginTop: spacing.sm, textAlign: 'center', fontSize: 13, fontFamily: fonts.regular, color: colors.textFaint },
  declineLink: { alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  declineLinkText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textFaint },
  declineOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.46)' },
  declineBackdrop: { ...StyleSheet.absoluteFillObject },
  declineSheet: { paddingHorizontal: spacing.xxl, paddingTop: spacing.md, paddingBottom: 30, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.bg },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.full, backgroundColor: colors.border, marginBottom: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  sheetBody: { marginTop: spacing.md, fontSize: 14, lineHeight: 22, fontFamily: fonts.regular, color: colors.textSecondary },
  consequenceCard: { gap: 11, marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  consequenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  consequenceIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successLight },
  consequenceIconDanger: { backgroundColor: colors.dangerLight },
  consequenceText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: fonts.regular, color: colors.textSecondary },
  reconsiderCard: { marginVertical: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  reconsiderText: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.textSecondary },
  sheetError: { marginBottom: spacing.md, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.danger },
  declineConfirm: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm },
  declineConfirmText: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.danger },
});
