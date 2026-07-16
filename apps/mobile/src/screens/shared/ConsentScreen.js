import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function ConsentScreen({ childId, childName, onDone }) {
  const { profile } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConsent() {
    setLoading(true);
    await supabase
      .from('parent_children')
      .update({ consent_given_at: new Date().toISOString() })
      .eq('parent_id', profile.id)
      .eq('child_id', childId);
    setLoading(false);
    onDone();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>Before you continue</Text>
      <Text style={styles.subtitle}>
        Your daycare uses DailyLog to share daily updates about <Text style={{ fontWeight: '600' }}>{childName}</Text> with you.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What we collect</Text>
        {[
          ['📋', 'Daily mood and general wellbeing'],
          ['🍽', 'Meal times and food eaten'],
          ['🩲', 'Diaper and toilet activity'],
          ['😴', 'Nap times'],
          ['🎨', 'Activities completed'],
          ['📦', 'Supply requests from your educator'],
          ['📝', 'Notes and comments from the educator'],
        ].map(([icon, text]) => (
          <View key={text} style={styles.dataRow}>
            <Text style={styles.dataIcon}>{icon}</Text>
            <Text style={styles.dataText}>{text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How it's used</Text>
        <Text style={styles.bodyText}>
          This information is only shared between your daycare's educators and the parents or guardians linked to your child. It is never sold, shared with advertisers, or used for any purpose other than keeping you informed about your child's day.
        </Text>
        <Text style={[styles.bodyText, { marginTop: spacing.sm }]}>
          You can request deletion of all data at any time from the Settings screen.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.checkRow}
        onPress={() => setAgreed(a => !a)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
          {agreed && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.checkLabel}>
          I consent to DailyLog collecting and sharing daily care information about {childName} as described above.
        </Text>
      </TouchableOpacity>

      <Button
        label="Continue"
        onPress={handleConsent}
        loading={loading}
        style={[styles.btn, !agreed && { opacity: 0.4 }]}
      />
      {!agreed && <Text style={styles.hint}>Please check the box above to continue.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, alignItems: 'center' },
  icon: { fontSize: 48, marginBottom: spacing.md, marginTop: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl, lineHeight: 22 },
  card: {
    width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  dataIcon: { fontSize: 18, width: 28 },
  dataText: { fontSize: 14, color: colors.textPrimary, flex: 1 },
  bodyText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, width: '100%', marginVertical: spacing.xl },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 14, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  btn: { width: '100%' },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
});
