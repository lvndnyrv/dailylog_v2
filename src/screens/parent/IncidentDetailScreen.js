import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, Image, ActivityIndicator
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useIncidentForm } from '../../hooks/useIncidentReport';
import { ChildAvatar } from '../../components/ChildAvatar';
import { Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

const SEVERITY_META = {
  minor: { label: 'Minor', color: colors.amber, bg: colors.amberLight, emoji: '🟡' },
  moderate: { label: 'Moderate', color: colors.coral, bg: colors.coralLight, emoji: '🟠' },
  serious: { label: 'Serious', color: colors.danger, bg: colors.dangerLight, emoji: '🔴' },
};

export default function IncidentDetailScreen({ route, navigation }) {
  const { incident, child } = route.params;
  const { profile } = useAuth();
  const { acknowledgeReport, getPhotoUrl } = useIncidentForm(incident.id);

  const [acknowledging, setAcknowledging] = useState(false);
  const [ackName, setAckName] = useState(profile?.full_name || '');
  const [showAckForm, setShowAckForm] = useState(false);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);

  const sev = SEVERITY_META[incident.severity] || SEVERITY_META.minor;
  const isAcknowledged = incident.status === 'acknowledged';

  useEffect(() => {
    async function loadPhotos() {
      if (!incident.photo_paths?.length) { setLoadingPhotos(false); return; }
      const urls = [];
      for (const path of incident.photo_paths) {
        const url = await getPhotoUrl(path);
        if (url) urls.push(url);
      }
      setPhotoUrls(urls);
      setLoadingPhotos(false);
    }
    loadPhotos();
  }, [incident.photo_paths]);

  async function handleAcknowledge() {
    if (!ackName.trim()) {
      Alert.alert('Required', 'Please type your full name to acknowledge this report.');
      return;
    }
    setAcknowledging(true);
    const { error } = await acknowledgeReport(incident.id, ackName.trim());
    setAcknowledging(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    Alert.alert('Acknowledged ✓', 'Thank you. This report has been marked as reviewed.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incident report</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Severity banner */}
        <View style={[styles.severityBanner, { backgroundColor: sev.bg, borderColor: sev.color + '44' }]}>
          <Text style={styles.severityEmoji}>{sev.emoji}</Text>
          <View>
            <Text style={[styles.severityLabel, { color: sev.color }]}>{sev.label} incident</Text>
            <Text style={styles.severityDate}>
              {format(new Date(incident.occurred_at), 'EEEE, MMMM d · h:mm a')}
            </Text>
          </View>
        </View>

        {/* Child info */}
        <View style={styles.childRow}>
          <ChildAvatar child={child} size={44} />
          <View>
            <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
            <Text style={styles.childSub}>
              Reported by educator · {format(new Date(incident.created_at), 'h:mm a')}
            </Text>
          </View>
        </View>

        {/* Details card */}
        <View style={styles.card}>
          <DetailRow label="Location" value={incident.location} />
          <DetailRow label="Injury type" value={incident.injury_type} />
          <DetailRow label="Body parts" value={incident.body_parts?.join(', ')} />
          {incident.description ? <DetailRow label="What happened" value={incident.description} /> : null}
          <DetailRow label="First aid" value={incident.first_aid_given || 'None documented'} />
          {incident.witnesses?.length > 0 && (
            <DetailRow label="Witnesses" value={incident.witnesses.join(', ')} />
          )}
          {incident.notes ? <DetailRow label="Notes" value={incident.notes} /> : null}
        </View>

        {/* Photos */}
        {incident.photo_paths?.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📷 Photos</Text>
            {loadingPhotos ? (
              <ActivityIndicator color={colors.primary} style={{ padding: spacing.lg }} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {photoUrls.map((url, i) => (
                  <Image key={i} source={{ uri: url }} style={styles.photo} />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Status */}
        <View style={styles.statusCard}>
          {isAcknowledged ? (
            <>
              <Text style={styles.statusIcon}>✅</Text>
              <Text style={styles.statusTitle}>Acknowledged</Text>
              <Text style={styles.statusSub}>
                By {incident.parent_acknowledge_name} · {format(new Date(incident.parent_acknowledged_at), 'MMM d, h:mm a')}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.statusIcon}>⏳</Text>
              <Text style={styles.statusTitle}>Awaiting acknowledgment</Text>
              <Text style={styles.statusSub}>
                Please review the details above and acknowledge this report.
              </Text>
            </>
          )}
        </View>

        {/* Acknowledge form (parent only, if not yet acknowledged) */}
        {!isAcknowledged && profile?.role === 'parent' && (
          <>
            {!showAckForm ? (
              <Button
                label="I have reviewed this report"
                onPress={() => setShowAckForm(true)}
                style={styles.ackButton}
              />
            ) : (
              <View style={styles.ackForm}>
                <Text style={styles.ackLabel}>
                  Type your full name to acknowledge:
                </Text>
                <TextInput
                  style={styles.ackInput}
                  value={ackName}
                  onChangeText={setAckName}
                  placeholder="Your full name"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <Text style={styles.ackDisclaimer}>
                  By acknowledging, I confirm that I have been informed of this incident and reviewed the details above.
                </Text>
                <Button
                  label={acknowledging ? 'Submitting...' : 'Acknowledge report'}
                  onPress={handleAcknowledge}
                  loading={acknowledging}
                  style={{ backgroundColor: colors.primary }}
                />
              </View>
            )}
          </>
        )}

        <View style={{ height: spacing.xxxl * 2 }} />
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={detailStyles.value}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border + '55' },
  label: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginBottom: 2 },
  value: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl + spacing.md, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },

  scroll: { flex: 1 },
  content: { padding: spacing.xl },

  severityBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, marginBottom: spacing.lg,
  },
  severityEmoji: { fontSize: 28 },
  severityLabel: { fontSize: 16, fontWeight: '700' },
  severityDate: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  childRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginBottom: spacing.lg,
  },
  childName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  childSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  photo: { width: 120, height: 120, borderRadius: radius.md, marginRight: spacing.sm },

  statusCard: {
    alignItems: 'center', padding: spacing.xl,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
  },
  statusIcon: { fontSize: 32, marginBottom: spacing.sm },
  statusTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  statusSub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },

  ackButton: { marginBottom: spacing.lg },
  ackForm: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.primary + '44',
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  ackLabel: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, marginBottom: spacing.md },
  ackInput: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, fontSize: 15, color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  ackDisclaimer: {
    fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: spacing.lg,
  },
});


