import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useClassroom } from '../hooks/useClassroom';
import { useRoomEditAccess } from '../hooks/useRoomEditAccess';
import { colors, fonts, spacing, radius } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

export function ClassroomSwitcher({ compact = false, childCount }) {
  const navigation = useNavigation();
  const { classrooms, active, switchClassroom } = useClassroom();
  const { canEditRooms } = useRoomEditAccess();
  const [showPicker, setShowPicker] = useState(false);
  const [switching, setSwitching] = useState(false);

  const dateStr = format(new Date(), 'EEEE, MMMM d');
  const canAddClassroom = canEditRooms;
  const canOpenPicker = classrooms.length > 1 || canAddClassroom;

  function openRoomSetup() {
    setShowPicker(false);
    navigation.navigate('AdminTabs', { screen: 'ManageTab', params: { openCreateRoom: true } });
  }

  async function selectRoom(roomId) {
    if (switching) return;
    setSwitching(true);
    try {
      if (await switchClassroom(roomId)) setShowPicker(false);
    } finally {
      setSwitching(false);
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
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.overlayDismiss}
            activeOpacity={1}
            onPress={() => setShowPicker(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Switch classroom</Text>
              <TouchableOpacity
                onPress={() => setShowPicker(false)}
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
                  onPress={() => selectRoom(room.id)}
                  disabled={switching}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: switching, selected: room.id === active?.id }}
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
              {canAddClassroom ? (
                <TouchableOpacity style={styles.addRoomBtn} onPress={openRoomSetup}
                  accessibilityRole="button" accessibilityLabel="Add another classroom">
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                  <Text style={styles.addRoomText}>Add another classroom</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </View>
        </View>
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

});
