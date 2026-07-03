import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Alert, TextInput, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { useClassroom } from '../hooks/useClassroom';
import { colors, spacing, radius } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

export function ClassroomSwitcher() {
  const { classrooms, active, switchClassroom, createAndJoinClassroom } = useClassroom();
  const [showPicker, setShowPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState('');
  const [creating, setCreating] = useState(false);

  const dateStr = format(new Date(), 'EEEE, MMMM d');

  async function handleCreate() {
    if (!newName.trim()) {
      Alert.alert('Required', 'Please enter a classroom name.');
      return;
    }
    setCreating(true);
    const { error } = await createAndJoinClassroom(newName.trim(), newAge.trim());
    setCreating(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setShowCreate(false);
      setShowPicker(false);
      setNewName('');
      setNewAge('');
    }
  }

  return (
    <>
      {/* Inline subtitle — date + classroom name */}
      <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.subtitle} activeOpacity={0.6}>
        <Text style={styles.dateText}>{dateStr}</Text>
        <Text style={styles.dot}> · </Text>
        <Ionicons name="school-outline" size={13} color={colors.primary} />
        <Text style={styles.roomName}> {active?.name || 'No room'}</Text>
        {classrooms.length > 1 && <Ionicons name="chevron-down" size={12} color={colors.primary} />}
        {classrooms.length <= 1 && <Ionicons name="add-circle-outline" size={13} color={colors.textMuted} style={{ marginLeft: 4 }} />}
      </TouchableOpacity>

      {/* Classroom picker modal */}
      <Modal visible={showPicker} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Switch classroom</Text>
              <TouchableOpacity onPress={() => { setShowPicker(false); setShowCreate(false); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {classrooms.map(room => (
                <TouchableOpacity
                  key={room.id}
                  style={[styles.roomRow, room.id === active?.id && styles.roomRowActive]}
                  onPress={() => { switchClassroom(room.id); setShowPicker(false); setShowCreate(false); }}
                >
                  <View style={[styles.roomIcon, room.id === active?.id && styles.roomIconActive]}>
                    <Ionicons
                      name={room.id === active?.id ? 'school' : 'school-outline'}
                      size={20}
                      color={room.id === active?.id ? colors.primary : colors.textMuted}
                    />
                  </View>
                  <View style={styles.roomInfo}>
                    <Text style={[styles.roomLabel, room.id === active?.id && { color: colors.primary, fontWeight: '600' }]}>
                      {room.name}
                    </Text>
                    {room.age_group && <Text style={styles.roomAge}>{room.age_group}</Text>}
                  </View>
                  {room.id === active?.id && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}

              {/* Add new classroom */}
              {!showCreate ? (
                <TouchableOpacity style={styles.addRoomBtn} onPress={() => setShowCreate(true)}>
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={styles.addRoomText}>Add another classroom</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.createForm}>
                  <Text style={styles.createTitle}>New classroom</Text>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Name (e.g. Room 2)"
                    placeholderTextColor={colors.textMuted}
                    style={styles.createInput}
                    autoFocus
                  />
                  <TextInput
                    value={newAge}
                    onChangeText={setNewAge}
                    placeholder="Age group (e.g. Preschool)"
                    placeholderTextColor={colors.textMuted}
                    style={styles.createInput}
                  />
                  <View style={styles.createBtns}>
                    <TouchableOpacity
                      onPress={() => { setShowCreate(false); setNewName(''); setNewAge(''); }}
                      style={styles.createCancel}
                    >
                      <Text style={styles.createCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleCreate}
                      disabled={creating}
                      style={[styles.createSubmit, creating && { opacity: 0.5 }]}
                    >
                      <Text style={styles.createSubmitText}>{creating ? 'Creating...' : 'Create'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Inline subtitle
  subtitle: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 3, flexWrap: 'nowrap',
  },
  dateText: { fontSize: 13, color: colors.textSecondary },
  dot: { fontSize: 13, color: colors.textMuted },
  roomName: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  // Modal
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 40, maxHeight: '70%',
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },

  roomRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  roomRowActive: { backgroundColor: colors.primaryLight + '66' },
  roomIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  roomIconActive: { backgroundColor: colors.primaryLight },
  roomInfo: { flex: 1 },
  roomLabel: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  roomAge: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  addRoomBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  addRoomText: { fontSize: 15, color: colors.primary, fontWeight: '500' },

  createForm: {
    padding: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  createTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  createInput: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  createBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  createCancel: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  createCancelText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  createSubmit: {
    flex: 2, paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  createSubmitText: { fontSize: 14, color: colors.white, fontWeight: '600' },
});
