import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRoomRatios } from '../hooks/useRoomRatios';
import { colors, fonts, radius, spacing } from '../theme';

export function RatioAlertGate({ navigation }) {
  const { rooms } = useRoomRatios();
  const [dismissedEvent, setDismissedEvent] = useState(null);

  const room = useMemo(
    () => rooms.find((candidate) => candidate.alert_ready),
    [rooms]
  );
  const eventKey = room ? `${room.id}:${room.over_since || ''}` : null;
  const visible = Boolean(room && eventKey !== dismissedEvent);

  function openDashboard(openAssigner) {
    setDismissedEvent(eventKey);
    navigation.navigate('RoomRatios', {
      roomId: room.id,
      openAssigner: Boolean(openAssigner),
    });
  }

  if (!room) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.alertIcon}>
            <Ionicons name="warning-outline" size={34} color={colors.coral} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>{room.name} is over ratio</Text>
            <Text style={styles.body}>
              {room.present_count} children with {room.staff_count}{' '}
              {room.staff_count === 1 ? 'educator' : 'educators'}. Licensing requires{' '}
              {room.required_staff} for this age group.
            </Text>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metricCard}>
              <Text style={[styles.metricValue, styles.currentValue]}>
                {room.actual_children_per_staff}:1
              </Text>
              <Text style={styles.metricLabel}>Current</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={[styles.metricValue, styles.requiredValue]}>
                {room.max_children_per_staff}:1
              </Text>
              <Text style={styles.metricLabel}>Required max</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => openDashboard(true)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={`Assign a floater to ${room.name}`}
          >
            <Text style={styles.primaryButtonText}>Assign a floater</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => openDashboard(false)}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>View all rooms</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(41, 62, 89, 0.52)',
  },
  sheet: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  alertIcon: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 31,
    backgroundColor: colors.coralLight,
  },
  copy: { alignItems: 'center' },
  title: {
    fontSize: 22,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  metrics: { flexDirection: 'row', gap: spacing.md, width: '100%' },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  metricValue: { fontSize: 20, fontFamily: fonts.black },
  currentValue: { color: colors.coral },
  requiredValue: { color: colors.success },
  metricLabel: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  primaryButton: {
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { fontSize: 16, fontFamily: fonts.bold, color: colors.white },
  secondaryButton: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xs },
  secondaryButtonText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textMuted },
});
