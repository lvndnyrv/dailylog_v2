import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Alert, TextInput, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { isAdminRole } from '@dailylog/shared';
import { useClassroom } from '../hooks/useClassroom';
import { useAuth } from '../hooks/useAuth';
import { colors, fonts, spacing, radius } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

export function ClassroomSwitcher({ compact = false, childCount }) {
  const { profile } = useAuth();
  const { classrooms, active, switchClassroom, createAndJoinClassroom } = useClassroom();
  const [showPicker, setShowPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState('');
  const [creating, setCreating] = useState(false);

  const dateStr = format(new Date(), 'EEEE, MMMM d');
  const canAddClassroom = isAdminRole(profile?.role);
  const canOpenPicker = classrooms.length > 1 || canAddClassroom;

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
      <TouchableOpacity
        onPress={() => setShowPicker(true)}
        style={styles.subtitle}
        activeOpacity={0.6}
        disabled={!canOpenPicker}
        accessibilityRole="button"
        accessibilityLabel={active ? `Current classroom, ${active.name}` : 'Choose classroom'}
        accessibilityState={{ disabled: !canOpenPicker }}
      >
        {!compact && (
          <>
            <Text style={styles.dateText}>{dateStr}</Text>
            <Text style={styles.dot}> · </Text>
            <Ionicons name="school-outline" size={13} color={colors.primary} />
          </>
        )}
        <Text style={styles.roomName}>{compact ? '' : ' '}{active?.name || 'No room'}</Text>
        {canOpenPicker && (
          <Ionicons
            name={classrooms.length > 1 ? 'chevron-down' : 'add-circle-outline'}
            size={13}
            color={colors.primary}
            style={{ marginLeft: 2 }}
          />
        )}
        {compact && Number.isFinite(childCount) && (
          <Text style={styles.compactCount}> · {childCount} children</Text>
        )}
      </TouchableOpacity>

      {/* Classroom picker modal */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowPicker(false); setShowCreate(false); }}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.overlayDismiss}
            activeOpacity={1}
            onPress={() => { setShowPicker(false); setShowCreate(false); }}
          />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Switch classroom</Text>
              <TouchableOpacity
                onPress={() => { setShowPicker(false); setShowCreate(false); }}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close classroom picker"
              >
                <Ionicons name="close" size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.roomList}
            >
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
              {canAddClassroom && !showCreate ? (
                <TouchableOpacity style={styles.addRoomBtn} onPress={() => setShowCreate(true)}>
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={styles.addRoomText}>Add another classroom</Text>
                </TouchableOpacity>
              ) : canAddClassroom ? (
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
              ) : null}
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
    marginTop: 4, flexWrap: 'nowrap',
    paddingVertical: 6,
  },
  dateText: { fontSize: 13.5, fontFamily: fonts.regular, color: colors.textSecondary },
  dot: { fontSize: 13.5, fontFamily: fonts.regular, color: colors.textMuted },
  roomName: { fontSize: 13.5, color: colors.primary, fontFamily: fonts.bold },
  compactCount: { fontSize: 13, fontFamily: fonts.regular, color: colors.textFaint },

  // Modal
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  overlayDismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: spacing.md,
    paddingBottom: 40,
    maxHeight: '74%',
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  sheetTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomList: {
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },

  roomRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  roomRowActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  roomIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  roomIconActive: { backgroundColor: colors.surface },
  roomInfo: { flex: 1 },
  roomLabel: { fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary },
  roomAge: { fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },

  addRoomBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.xs, paddingVertical: spacing.md,
  },
  addRoomText: { fontSize: 14.5, color: colors.primary, fontFamily: fonts.bold },

  createForm: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  createTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: spacing.md },
  createInput: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, fontFamily: fonts.regular, color: colors.textPrimary, marginBottom: spacing.sm,
  },
  createBtns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  createCancel: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  createCancelText: { fontSize: 14, color: colors.textSecondary, fontFamily: fonts.bold },
  createSubmit: {
    flex: 2, paddingVertical: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  createSubmitText: { fontSize: 14, color: colors.white, fontFamily: fonts.bold },
});
