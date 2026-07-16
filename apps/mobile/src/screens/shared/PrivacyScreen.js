import React from 'react';
import { ScrollView, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius } from '../../theme';

export default function PrivacyScreen({ navigation }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Privacy Policy</Text>
      <Text style={styles.updated}>Last updated: June 2026</Text>

      <Section title="Who we are">
        DailyLog is a mobile application used by Smart Kid South Newmarket to share
        daily care updates between daycare educators and parents or guardians.
      </Section>

      <Section title="What information we collect">
        We collect information provided by authorized daycare educators on behalf of
        enrolled children, including:{'\n\n'}
        • Child's first and last name{'\n'}
        • Daily mood observations{'\n'}
        • Meal times and food consumed{'\n'}
        • Diaper and toilet activity{'\n'}
        • Nap start and end times{'\n'}
        • Activities completed during the day{'\n'}
        • Supply requests from educators{'\n'}
        • Notes and comments from educators{'\n\n'}
        We also collect account information for educators and parents: name, email
        address, and role. We collect device push notification tokens to deliver
        daily log notifications to parents.
      </Section>

      <Section title="How we use this information">
        All information is used solely to share daily care updates between your
        daycare's educators and the parents or guardians of enrolled children.
        {'\n\n'}
        We do not sell your data. We do not share your data with advertisers. We
        do not use your data for any purpose other than operating the DailyLog
        service for your daycare.
      </Section>

      <Section title="Children's privacy (COPPA & PIPEDA)">
        DailyLog is a professional tool used by adults. Children do not use this
        application directly. However, we collect personal information about children
        as provided by authorized educators.{'\n\n'}
        In accordance with COPPA and Canada's PIPEDA, we:{'\n'}
        • Obtain parental or guardian consent before linking a child's records to a
          parent account{'\n'}
        • Collect only the minimum information necessary for daycare communication{'\n'}
        • Do not share children's information with any third party{'\n'}
        • Allow parents to request full deletion of their child's data at any time
      </Section>

      <Section title="Data storage and security">
        All data is stored securely using Supabase, hosted in a Canadian data
        region. Access is restricted by role-based security rules — educators can
        only access children in their classroom, and parents can only access their
        own linked children. All data is transmitted over HTTPS.
      </Section>

      <Section title="Data retention">
        Daily log records are retained for one year and then automatically deleted.
        Account data is retained as long as you have an active account. You may
        request deletion of your account and all associated data at any time
        through Settings → Delete my account.
      </Section>

      <Section title="Your rights">
        You have the right to:{'\n'}
        • Access all data we hold about you or your child{'\n'}
        • Request correction of inaccurate data{'\n'}
        • Request deletion of your account and all associated data{'\n'}
        • Withdraw consent at any time{'\n\n'}
        To exercise these rights, use the Settings screen in the app or contact
        us at privacy@yourdomain.app.
      </Section>

      <Section title="Contact">
        For any privacy questions or concerns:{'\n'}
        privacy@yourdomain.app{'\n'}
        Smart Kid South Newmarket{'\n'}
        South Newmarket, Ontario, Canada
      </Section>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  back: { marginBottom: spacing.xl },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  updated: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  sectionBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
});
