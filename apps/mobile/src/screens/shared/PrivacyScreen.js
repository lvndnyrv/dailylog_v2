import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius, spacing } from '../../theme';

const POLICY_VERSION = '2026-10-09';

export default function PrivacyScreen({ navigation }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
      </View>

      <View style={styles.heroIcon}>
        <Ionicons name="shield-checkmark-outline" size={30} color={colors.primary} />
      </View>
      <Text style={styles.title}>Your family's information</Text>
      <Text style={styles.updated}>Privacy notice · Version {POLICY_VERSION}</Text>
      <Text style={styles.intro}>
        DailyLog helps childcare centers, their staff, and authorized family members
        coordinate care. Children do not create or operate DailyLog accounts.
      </Text>

      <Section title="Information DailyLog handles">
        Account and contact details such as names, email addresses, phone numbers,
        roles, and center membership.{`\n\n`}
        Childcare records such as child profiles and photos, attendance, daily care
        entries, allergies and medical instructions, incidents, authorized pickup
        people, enrollment documents, consents, and family-staff messages.{`\n\n`}
        Operational and billing records such as schedules, invoices, payment status,
        staff records, and compliance records. DailyLog also stores device push tokens
        and limited technical information needed to sign in, secure the app, and deliver
        notifications.
      </Section>

      <Section title="How the information is used">
        Information is used to provide childcare communication and center operations,
        protect accounts, send requested notifications, support enrollment and billing,
        meet record-keeping obligations, and respond to privacy requests.{`\n\n`}
        DailyLog does not sell personal information, use it for third-party advertising,
        or track people across other companies' apps or websites.
      </Section>

      <Section title="Photos, camera, calendar, and biometrics">
        Camera and photo-library access is used only when you choose to capture, scan,
        or attach an image. Calendar access is requested only when you choose to add a
        center closure or booked tour. Face ID or fingerprint checks stay on your device
        and are used only when you enable app lock in Settings. DailyLog does not receive
        your biometric data.
      </Section>

      <Section title="Service providers and storage">
        DailyLog uses service providers to operate the app, including Supabase for
        authentication, database, and file storage, and Apple, Google, and Expo for app
        delivery and push notifications. These providers process information only to
        deliver the service.{`\n\n`}
        The currently connected Supabase project is hosted in the United States. Data is
        encrypted in transit. Access controls limit records by center, role, classroom,
        and family relationship.
      </Section>

      <Section title="Retention and deletion">
        Records are retained according to the childcare center's policies and applicable
        childcare, tax, employment, safety, and legal requirements. A request to close an
        account does not automatically erase records the center is required to keep.{`\n\n`}
        When information is no longer required, the center can remove or anonymize it in
        line with its obligations.
      </Section>

      <Section title="Your choices and rights">
        Depending on your location, you may ask to access, correct, export, or delete
        personal information, or withdraw an optional consent. Parents and guardians can
        start a request from Me → Privacy & data. Staff and administrators can contact
        their center administrator. Identity and legal retention requirements are checked
        before a request is completed.
      </Section>

      <Section title="Children's privacy">
        A center must have appropriate authority and parent or guardian consent before it
        adds or shares a child's information. DailyLog is designed for authorized adults;
        it is not directed to children and does not allow children to create accounts.
      </Section>

      <View style={styles.notice}>
        <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.noticeText}>
          Questions about a child's records or a privacy request should be sent to the
          childcare center that controls those records. Its contact details are available
          in your center profile and enrollment documents.
        </Text>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }) {
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
    maxWidth: 560,
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
  headerTitle: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    backgroundColor: colors.primarySoft,
  },
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  updated: {
    marginTop: spacing.xs,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  intro: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
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
    marginBottom: spacing.sm,
    fontSize: 15.5,
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
