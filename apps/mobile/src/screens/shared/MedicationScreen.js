import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Modal
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { notifyMedicationGiven } from '../../hooks/usePushNotifications';
import { Input, Button, Divider, EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

/**
 * Medication tracking for one child.
 *  - Parents: create/end medication authorizations
 *  - Staff (educator/admin): log administered doses against active authorizations
 *  - Both: see authorization list + administration history
 */
export default function MedicationScreen({ route, navigation }) {
  const { child } = route.params;
  const { profile } = useAuth();

  const [auths, setAuths]       = useState([]);
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);

  // Parent composer
  const [composing, setComposing] = useState(false);
  const [name, setName]         = useState('');
  const [dosage, setDosage]     = useState('');
  const [schedule, setSchedule] = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);

  // Staff dose logger
  const [dosingAuth, setDosingAuth] = useState(null); // authorization being administered
  const [doseGiven, setDoseGiven]   = useState('');
  const [doseNotes, setDoseNotes]   = useState('');
  const [savingDose, setSavingDose] = useState(false);

  const isStaff  = profile?.role === 'educator' || profile?.role === 'admin';
  const isParent = profile?.role === 'parent';

  useEffect(() => { load(); }, []);

  async function load() {
    const [authRes, logRes] = await Promise.all([
      supabase
        .from('medication_authorizations')
        .select('*, parent:profiles(full_name)')
        .eq('child_id', child.id)
        .order('active', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('medication_logs')
        .select('*, administered_by_profile:profiles!medication_logs_administered_by_fkey(full_name), authorization:medication_authorizations(name, dosage)')
        .eq('child_id', child.id)
        .order('administered_at', { ascending: false })
        .limit(30),
    ]);
    setAuths(authRes.data || []);
    setLogs(logRes.data || []);
    setLoading(false);
  }

  // ─── Parent: authorize a medication ────────────────────────────────────────
  async function handleAuthorize() {
    if (!name.trim() || !dosage.trim()) {
      Alert.alert('Required', 'Please enter the medication name and dosage.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('medication_authorizations').insert({
      child_id: child.id,
      parent_id: profile.id,
      name: name.trim(),
      dosage: dosage.trim(),
      schedule: schedule.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setComposing(false);
    setName(''); setDosage(''); setSchedule(''); setNotes('');
    showToast('💊 Medication authorized', 'success');
    load();
  }

  async function handleEndAuthorization(auth) {
    Alert.alert(
      'End authorization',
      `Stop authorizing "${auth.name}"? Educators will no longer be able to log doses.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('medication_authorizations')
              .update({ active: false, end_date: format(new Date(), 'yyyy-MM-dd') })
              .eq('id', auth.id);
            if (error) Alert.alert('Error', error.message);
            else load();
          },
        },
      ]
    );
  }

  // ─── Staff: log a dose ──────────────────────────────────────────────────────
  async function handleLogDose() {
    if (!dosingAuth) return;
    setSavingDose(true);
    const { error } = await supabase.from('medication_logs').insert({
      authorization_id: dosingAuth.id,
      child_id: child.id,
      administered_by: profile.id,
      dosage_given: doseGiven.trim() || dosingAuth.dosage,
      notes: doseNotes.trim() || null,
    });
    setSavingDose(false);
    if (error) { Alert.alert('Error', error.message); return; }

    // Notify parents (fire-and-forget)
    notifyMedicationGiven(child.id, child.first_name, dosingAuth.name);

    setDosingAuth(null);
    setDoseGiven(''); setDoseNotes('');
    showToast('💊 Dose logged — parents notified', 'success');
    load();
  }

  const activeAuths = auths.filter(a => a.active);
  const pastAuths   = auths.filter(a => !a.active);

  if (loading) {
    return <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>💊 Medications</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={styles.childName}>{child.first_name} {child.last_name || ''}</Text>

      {/* Parent: authorize button */}
      {isParent && (
        <Button
          label="+ Authorize a medication"
          onPress={() => setComposing(true)}
          style={{ marginBottom: spacing.lg }}
        />
      )}

      {/* Active authorizations */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Active authorizations</Text>
        {activeAuths.length === 0 ? (
          <Text style={styles.emptyText}>
            {isParent
              ? 'No active medications. Tap "Authorize a medication" to add one.'
              : 'No medications authorized for this child.'}
          </Text>
        ) : (
          activeAuths.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider />}
              <View style={styles.authRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.authName}>{a.name}</Text>
                  <Text style={styles.authDetail}>Dosage: {a.dosage}</Text>
                  {a.schedule && <Text style={styles.authDetail}>Schedule: {a.schedule}</Text>}
                  {a.notes && <Text style={styles.authNotes}>{a.notes}</Text>}
                  <Text style={styles.authMeta}>
                    Authorized by {a.parent?.full_name || 'parent'} · {format(new Date(a.created_at), 'MMM d')}
                  </Text>
                </View>
                <View style={styles.authActions}>
                  {isStaff && (
                    <TouchableOpacity
                      onPress={() => { setDosingAuth(a); setDoseGiven(a.dosage); }}
                      style={styles.doseBtn}
                    >
                      <Text style={styles.doseBtnText}>Log dose</Text>
                    </TouchableOpacity>
                  )}
                  {isParent && a.parent_id === profile.id && (
                    <TouchableOpacity
                      onPress={() => handleEndAuthorization(a)}
                      style={styles.endBtn}
                    >
                      <Text style={styles.endBtnText}>End</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Administration history */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Administration history</Text>
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>No doses logged yet.</Text>
        ) : (
          logs.map((l, i) => (
            <View key={l.id}>
              {i > 0 && <Divider />}
              <View style={styles.logRow}>
                <Text style={styles.logDot}>💊</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logTitle}>
                    {l.authorization?.name || 'Medication'} — {l.dosage_given || l.authorization?.dosage}
                  </Text>
                  <Text style={styles.logMeta}>
                    {format(new Date(l.administered_at), 'MMM d, h:mm a')} · by {l.administered_by_profile?.full_name || 'staff'}
                  </Text>
                  {l.notes ? <Text style={styles.logNotes}>{l.notes}</Text> : null}
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Past authorizations */}
      {pastAuths.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Past authorizations</Text>
          {pastAuths.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <Divider />}
              <View style={styles.authRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.authName, { color: colors.textMuted }]}>{a.name}</Text>
                  <Text style={styles.authMeta}>
                    {a.dosage} · Ended {a.end_date ? format(new Date(a.end_date + 'T00:00:00'), 'MMM d, yyyy') : ''}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: spacing.xxxl }} />

      {/* Parent: authorize modal */}
      <Modal visible={composing} transparent animationType="slide">
        <View style={styles.overlay}>
          <KeyboardAwareScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setComposing(false)}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>Authorize medication</Text>
              <View style={{ width: 60 }} />
            </View>

            <Input label="Medication name *" value={name} onChangeText={setName} placeholder="e.g. Tylenol Children's" />
            <Input label="Dosage *" value={dosage} onChangeText={setDosage} placeholder="e.g. 5 ml" />
            <Input label="Schedule" value={schedule} onChangeText={setSchedule} placeholder="e.g. After lunch, as needed" />
            <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="Storage, side effects to watch..." multiline />

            <Button
              label={saving ? 'Saving...' : 'Authorize'}
              onPress={handleAuthorize}
              loading={saving}
              style={{ marginTop: spacing.md }}
            />
            <Text style={styles.disclaimer}>
              By authorizing, you permit daycare staff to administer this medication
              to {child.first_name} as described. Each dose is logged and you'll be notified.
            </Text>
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {/* Staff: log dose modal */}
      <Modal visible={!!dosingAuth} transparent animationType="slide">
        <View style={styles.overlay}>
          <KeyboardAwareScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setDosingAuth(null)}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>Log dose</Text>
              <View style={{ width: 60 }} />
            </View>

            <Text style={styles.doseMedName}>{dosingAuth?.name}</Text>
            <Text style={styles.doseMedDetail}>Authorized dosage: {dosingAuth?.dosage}</Text>
            {dosingAuth?.schedule && <Text style={styles.doseMedDetail}>Schedule: {dosingAuth.schedule}</Text>}

            <Input label="Dosage given" value={doseGiven} onChangeText={setDoseGiven} placeholder={dosingAuth?.dosage} />
            <Input label="Notes" value={doseNotes} onChangeText={setDoseNotes} placeholder="Optional notes..." multiline />

            <Button
              label={savingDose ? 'Logging...' : `Log dose at ${format(new Date(), 'h:mm a')}`}
              onPress={handleLogDose}
              loading={savingDose}
              style={{ marginTop: spacing.md }}
            />
            <Text style={styles.disclaimer}>
              Parents will receive a push notification confirming this dose.
            </Text>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  childName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  authRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  authName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  authDetail: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  authNotes: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },
  authMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  authActions: { gap: spacing.sm },
  doseBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  doseBtnText: { fontSize: 12, color: colors.white, fontWeight: '600' },
  endBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  endBtnText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
  logRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  logDot: { fontSize: 16 },
  logTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  logMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  logNotes: { fontSize: 12, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  sheetContent: { padding: spacing.xl, paddingBottom: 48 },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sheetCancel: { fontSize: 15, color: colors.textSecondary, width: 60 },
  sheetTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  disclaimer: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: spacing.md, textAlign: 'center' },
  doseMedName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  doseMedDetail: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
});

