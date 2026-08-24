import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/ui';
import { colors, fonts, spacing } from '../../theme';

function formatDate(value) {
  if (!value) return 'the new expiry';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function Step({ state, title, detail, isLast }) {
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <View style={[
          styles.node,
          state === 'done' && styles.nodeDone,
          state === 'pending' && styles.nodePending,
        ]}>
          {state === 'done'
            ? <Ionicons name="checkmark" size={13} color={colors.success} />
            : state === 'pending'
              ? <View style={styles.pendingDot} />
              : null}
        </View>
        {!isLast && <View style={styles.line} />}
      </View>
      <View style={styles.stepCopy}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={[styles.stepDetail, state === 'pending' && styles.pendingText]}>{detail}</Text>
      </View>
    </View>
  );
}

export default function CredentialSubmittedScreen({ navigation, route }) {
  const reviewerName = route.params?.reviewerName || 'your director';
  const expiresOn = route.params?.expiresOn;
  const credentialName = route.params?.credentialName || 'Credential';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={38} color={colors.success} />
        </View>
        <View style={styles.heading}>
          <Text style={styles.title}>Renewal submitted</Text>
          <Text style={styles.subtitle}>
            Sent to <Text style={styles.strong}>{reviewerName}</Text> to verify. Your expiry reminder clears after approval.
          </Text>
        </View>

        <View style={styles.timelineCard}>
          <Step
            state="done"
            title="Uploaded by you"
            detail={`${credentialName} · new expiry ${formatDate(expiresOn)}`}
          />
          <Step
            state="pending"
            title="Director verifies"
            detail={`Pending · ${reviewerName}`}
          />
          <Step
            state="future"
            title="Reminder cleared"
            detail={`Credential marked valid to ${formatDate(expiresOn)}`}
            isLast
          />
        </View>

        <View style={styles.spacer} />
        <Button
          label="Back to credentials"
          onPress={() => navigation.popTo('Credentials')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xl, gap: spacing.xl },
  successIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  heading: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  title: { fontSize: 23, fontFamily: fonts.black, color: colors.textPrimary },
  subtitle: { textAlign: 'center', fontSize: 13.5, lineHeight: 21, fontFamily: fonts.regular, color: colors.textMuted },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  timelineCard: { width: '100%', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, padding: spacing.lg, paddingBottom: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md, minHeight: 70 },
  rail: { width: 28, alignItems: 'center' },
  node: { width: 27, height: 27, borderRadius: 14, borderWidth: 1.7, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  nodeDone: { backgroundColor: colors.successLight, borderColor: colors.successLight },
  nodePending: { backgroundColor: colors.amberLight, borderColor: colors.amberLight },
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber },
  line: { width: 2, flex: 1, marginVertical: 2, backgroundColor: colors.border },
  stepCopy: { flex: 1, paddingTop: 3 },
  stepTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  stepDetail: { marginTop: 4, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.textFaint },
  pendingText: { color: colors.amber },
  spacer: { flex: 1 },
});
