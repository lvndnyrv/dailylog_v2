import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../theme';

const TERMS_VERSION = '2026-08-08';

export default function StaffTermsScreen({ navigation }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to invitation"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Staff Terms</Text>
      </View>

      <Text style={styles.title}>Staff terms & confidentiality</Text>
      <Text style={styles.updated}>Version {TERMS_VERSION}</Text>

      <TermsSection title="Use your own account">
        Keep your sign-in private, use only the access assigned to you, and tell your
        director promptly if your device or account may have been compromised.
      </TermsSection>
      <TermsSection title="Protect child and family information">
        Child records, photos, health details, attendance, pickup information, and
        family messages are confidential. View and share them only when your work
        requires it and only through center-approved channels.
      </TermsSection>
      <TermsSection title="Record care accurately">
        Enter observations and care events honestly, at the correct time, and for the
        correct child. Correct mistakes promptly and never alter a record to conceal
        an incident or missed task.
      </TermsSection>
      <TermsSection title="Follow center policies">
        Your center's employment, safeguarding, supervision, medication, incident,
        photography, and device-use policies still apply. DailyLog does not replace
        required training or professional judgment.
      </TermsSection>
      <TermsSection title="Access ends with your role">
        Your director may change or remove access when your assignment changes or
        employment ends. Do not retain or export center data after access is removed.
      </TermsSection>

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.noticeText}>
          Returning to the invitation does not accept these terms. You must select the
          checkbox and complete the invitation to record acceptance.
        </Text>
      </View>
    </ScrollView>
  );
}

function TermsSection({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  title: {
    fontSize: 25,
    lineHeight: 31,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  updated: {
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  card: {
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    marginBottom: spacing.xs,
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  cardText: {
    fontSize: 13.5,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  noticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
});
