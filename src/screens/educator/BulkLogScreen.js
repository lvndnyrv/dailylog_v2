import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, radius } from '../../theme';
import { Button, Chip } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { format } from 'date-fns';

const ACTIVITIES = [
  'Outdoors', 'Arts & crafts', 'Reading / language',
  'Singing / music', 'Motor skills', 'Toys',
  'Sensory play', 'Math', 'Science', 'Board games', 'Cooking class',
];

const MOODS = [
  { label: 'Happy', emoji: '😊' },
  { label: 'Fussy', emoji: '😤' },
  { label: 'Curious', emoji: '🧐' },
  { label: 'Irritable', emoji: '😠' },
  { label: 'Sleepy', emoji: '😴' },
  { label: 'Sick', emoji: '🤒' },
];

export default function BulkLogScreen({ navigation }) {
  const { profile }                     = useAuth();
  const { active: activeClassroom }     = useClassroom();
  const [children, setChildren]         = useState([]);
  const [selectedChildren, setSelected] = useState(new Set());
  const [selectedActivities, setActivities] = useState(new Set());
  const [selectedMoods, setMoods]       = useState(new Set());
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const today                           = format(new Date(), 'yyyy-MM-dd');

  const classroomId = activeClassroom?.id || profile?.classroom_id;

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('children')
        .select('*')
        .eq('classroom_id', classroomId)
        .is('archived_at', null)
        .order('first_name');
      const kids = data || [];
      setChildren(kids);
      // Select all children by default
      setSelected(new Set(kids.map(k => k.id)));
      setLoading(false);
    }
    if (classroomId) load();
  }, [classroomId]);

  function toggleChild(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedChildren.size === children.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(children.map(c => c.id)));
    }
  }

  function toggleActivity(a) {
    setActivities(prev => {
      const next = new Set(prev);
      next.has(a) ? next.delete(a) : next.add(a);
      return next;
    });
  }

  function toggleMood(m) {
    setMoods(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  async function handleApply() {
    if (!selectedChildren.size) {
      Alert.alert('No children selected', 'Please select at least one child.');
      return;
    }
    if (!selectedActivities.size && !selectedMoods.size) {
      Alert.alert('Nothing to log', 'Please select at least one activity or mood to apply.');
      return;
    }

    // Bulk apply needs the read-back of created log ids — require a connection
    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) {
      Alert.alert(
        "You're offline",
        'Bulk logging needs a connection. Log children individually from the roster (that works offline), or try again once you reconnect.'
      );
      return;
    }

    setSaving(true);

    const childIds = [...selectedChildren];

    // Batch get-or-create: race-safe upsert (DO NOTHING on conflict), then one select
    const { error: upsertError } = await supabase.from('daily_logs').upsert(
      childIds.map(childId => ({
        child_id: childId,
        log_date: today,
        educator_id: profile.id,
      })),
      { onConflict: 'child_id,log_date', ignoreDuplicates: true }
    );
    if (upsertError) {
      setSaving(false);
      Alert.alert('Error', upsertError.message);
      return;
    }

    const { data: logs, error: logsError } = await supabase
      .from('daily_logs')
      .select('id, child_id, moods')
      .in('child_id', childIds)
      .eq('log_date', today);

    if (logsError || !logs?.length) {
      setSaving(false);
      Alert.alert('Error', logsError?.message || 'Could not load daily logs.');
      return;
    }

    const logIds = logs.map(l => ({ childId: l.child_id, logId: l.id, currentMoods: l.moods || [] }));

    // Apply moods — merge with existing
    if (selectedMoods.size) {
      await Promise.all(
        logIds.map(({ logId, currentMoods }) => {
          const merged = [...new Set([...currentMoods, ...selectedMoods])];
          return supabase.from('daily_logs').update({ moods: merged }).eq('id', logId);
        })
      );
    }

    // Apply activities — one query for existing, one bulk insert for missing
    if (selectedActivities.size) {
      const { data: existing } = await supabase
        .from('activity_entries')
        .select('daily_log_id, activity_name')
        .in('daily_log_id', logIds.map(l => l.logId));

      const existingSet = new Set((existing || []).map(a => `${a.daily_log_id}:${a.activity_name}`));
      const toInsert = [];
      for (const { logId } of logIds) {
        for (const activity of selectedActivities) {
          if (!existingSet.has(`${logId}:${activity}`)) {
            toInsert.push({ daily_log_id: logId, activity_name: activity });
          }
        }
      }
      if (toInsert.length) {
        await supabase.from('activity_entries').insert(toInsert);
      }
    }

    setSaving(false);

    const summary = [];
    if (selectedMoods.size) summary.push(`mood: ${[...selectedMoods].join(', ')}`);
    if (selectedActivities.size) summary.push(`${selectedActivities.size} activities`);

    Alert.alert(
      'Applied ✓',
      `Logged ${summary.join(' and ')} for ${selectedChildren.size} ${selectedChildren.size === 1 ? 'child' : 'children'}.`,
      [{ text: 'Done' }]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const allSelected = selectedChildren.size === children.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Bulk log</Text>
      <Text style={styles.pageDesc}>
        Apply the same activities or mood to multiple children at once.
      </Text>

      {/* Children selector */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>👧 Apply to</Text>
          <TouchableOpacity onPress={toggleAll}>
            <Text style={styles.selectAll}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.childGrid}>
          {children.map(child => {
            const selected = selectedChildren.has(child.id);
            return (
              <TouchableOpacity
                key={child.id}
                onPress={() => toggleChild(child.id)}
                style={[styles.childChip, selected && styles.childChipSelected]}
                activeOpacity={0.7}
              >
                <ChildAvatar child={child} size={24} fontSize={12} />
                <Text style={[styles.childChipName, selected && { color: colors.primary, fontWeight: '600' }]}>
                  {child.first_name}
                </Text>
                {selected && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Mood selector */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>😊 Mood</Text>
        <Text style={styles.cardHint}>Optional — select if the whole group shared a mood</Text>
        <View style={styles.chipWrap}>
          {MOODS.map(m => (
            <Chip
              key={m.label}
              label={`${m.emoji} ${m.label}`}
              selected={selectedMoods.has(m.label)}
              onPress={() => toggleMood(m.label)}
            />
          ))}
        </View>
      </View>

      {/* Activities selector */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🎨 Activities</Text>
        <Text style={styles.cardHint}>Select all activities done today</Text>
        <View style={styles.chipWrap}>
          {ACTIVITIES.map(a => (
            <Chip
              key={a}
              label={a}
              selected={selectedActivities.has(a)}
              onPress={() => toggleActivity(a)}
              color={colors.purple}
              lightColor={colors.purpleLight}
            />
          ))}
        </View>
      </View>

      {/* Summary */}
      {(selectedActivities.size > 0 || selectedMoods.size > 0) && selectedChildren.size > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            Ready to log{' '}
            {selectedMoods.size > 0 && `${[...selectedMoods].join(' + ')} mood`}
            {selectedMoods.size > 0 && selectedActivities.size > 0 && ' and '}
            {selectedActivities.size > 0 && `${selectedActivities.size} activities`}
            {' '}for{' '}
            <Text style={{ fontWeight: '600' }}>
              {selectedChildren.size} {selectedChildren.size === 1 ? 'child' : 'children'}
            </Text>
          </Text>
        </View>
      )}

      <Button
        label={saving ? 'Applying...' : `Apply to ${selectedChildren.size} children`}
        onPress={handleApply}
        loading={saving}
        style={styles.applyBtn}
      />

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  back: { marginBottom: spacing.lg },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  pageDesc: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xl, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  cardHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  selectAll: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  childGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  childChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  childChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  childChipName: { fontSize: 14, color: colors.textSecondary },
  checkmark: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  summaryCard: {
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.primary + '44',
  },
  summaryText: { fontSize: 14, color: colors.primaryDark, lineHeight: 20 },
  applyBtn: { marginTop: spacing.sm },
});
