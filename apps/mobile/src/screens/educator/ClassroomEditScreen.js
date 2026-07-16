import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';
import { Button, Input } from '../../components/ui';

export default function ClassroomEditScreen({ route, navigation }) {
  const { classroom, childrenCount, canDelete } = route.params;
  const { reload: reloadClassrooms, leaveClassroom } = useClassroom();

  const [name, setName] = useState(classroom.name || '');
  const [ageGroup, setAgeGroup] = useState(classroom.age_group || '');
  const [saving, setSaving] = useState(false);

  const hasChanges = name.trim() !== (classroom.name || '') || ageGroup.trim() !== (classroom.age_group || '');

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a classroom name.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('classrooms')
      .update({ name: name.trim(), age_group: ageGroup.trim() || null })
      .eq('id', classroom.id);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await reloadClassrooms();
      navigation.goBack();
    }
  }

  function handleDelete() {
    if (childrenCount > 0) {
      Alert.alert(
        'Cannot delete',
        `This classroom still has ${childrenCount} children. Move or remove all children first before deleting the classroom.`
      );
      return;
    }
    Alert.alert(
      `Delete "${classroom.name}"?`,
      'This will permanently remove this classroom. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await supabase.from('classrooms').delete().eq('id', classroom.id);
            await leaveClassroom(classroom.id);
            await reloadClassrooms();
            navigation.goBack();
          },
        },
      ]
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit classroom</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Form */}
      <View style={styles.formCard}>
        <Input
          label="Classroom name (required)"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Toddlers Room 1"
        />
        <Input
          label="Age group (optional)"
          value={ageGroup}
          onChangeText={setAgeGroup}
          placeholder="e.g. 2–3 years"
        />

        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>👧</Text>
          <Text style={styles.infoText}>
            {childrenCount} {childrenCount === 1 ? 'child' : 'children'} enrolled
          </Text>
        </View>

        <Button
          label="Save changes"
          onPress={handleSave}
          loading={saving}
          style={[{ marginTop: spacing.lg }, !hasChanges && { opacity: 0.4 }]}
          disabled={!hasChanges}
        />
      </View>

      {/* Danger zone */}
      {canDelete && (
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Danger zone</Text>
          <Text style={styles.dangerText}>
            Deleting a classroom is permanent and cannot be undone. All children must be removed first.
          </Text>
          <Button
            label="Delete classroom"
            variant="danger"
            onPress={handleDelete}
            style={{ marginTop: spacing.md }}
          />
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  formCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  infoIcon: { fontSize: 14 },
  infoText: { fontSize: 13, color: colors.textMuted },
  dangerCard: {
    backgroundColor: colors.dangerLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.danger + '33',
    padding: spacing.lg,
  },
  dangerTitle: { fontSize: 15, fontWeight: '600', color: colors.danger, marginBottom: spacing.xs },
  dangerText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
});









