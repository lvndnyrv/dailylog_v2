import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRoomRatios } from '../../hooks/useRoomRatios';
import { colors, fonts, radius, spacing } from '../../theme';

function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function RatioCard({ room, onAssign }) {
  const over = room.is_over_ratio;
  const occupancy = room.required_staff
    ? Math.min(room.staff_count / room.required_staff, 1)
    : 1;

  return (
    <View style={[styles.roomCard, over && styles.roomCardOver]}>
      <View style={styles.roomHeading}>
        <Text style={styles.roomName}>{room.name}</Text>
        <View style={[styles.statusBadge, over ? styles.overBadge : styles.okBadge]}>
          <Text style={[styles.statusText, over ? styles.overText : styles.okText]}>
            {over ? `Over by ${room.over_by}` : `OK · ${room.actual_children_per_staff}:1`}
          </Text>
        </View>
      </View>
      <View style={styles.ratioRow}>
        <Text style={[styles.presentText, over && styles.presentTextOver]}>
          {room.present_count} {room.present_count === 1 ? 'child' : 'children'}
        </Text>
        <View style={[styles.progressTrack, over ? styles.progressTrackOver : styles.progressTrackOk]}>
          <View
            style={[
              styles.progressFill,
              over ? styles.progressFillOver : styles.progressFillOk,
              { width: `${Math.max(over ? 100 : occupancy * 100, 8)}%` },
            ]}
          />
        </View>
        <Text style={styles.staffText}>
          {room.staff_count} {room.staff_count === 1 ? 'staff' : 'staff'}
        </Text>
      </View>
      {over && (
        <TouchableOpacity
          style={styles.assignButton}
          onPress={() => onAssign(room)}
          activeOpacity={0.82}
          accessibilityRole="button"
        >
          <Text style={styles.assignButtonText}>Assign floater</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function FloaterSheet({ room, visible, onClose, loadFloaters, assignFloater }) {
  const [floaters, setFloaters] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !room) return;
    let current = true;
    setLoading(true);
    setFloaters([]);
    setSelectedId(null);
    loadFloaters(room.id)
      .then((data) => {
        if (!current) return;
        setFloaters(data);
        setSelectedId(data[0]?.staff_member_id || null);
      })
      .catch((error) => {
        if (current) Alert.alert('Could not load staff', error.message);
      })
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [loadFloaters, room, visible]);

  const selected = floaters.find((floater) => floater.staff_member_id === selectedId);

  async function confirm() {
    if (!selected || !room) return;
    setSaving(true);
    try {
      await assignFloater(room.id, selected.staff_member_id);
      onClose();
      Alert.alert(
        'Ratio restored',
        `${selected.full_name} was assigned to ${room.name}. The assignment is logged for licensing.`
      );
    } catch (error) {
      Alert.alert('Could not assign floater', error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Assign to {room?.name}</Text>
          <Text style={styles.sheetSubtitle}>
            Available staff who can restore the {room?.max_children_per_staff}:1 ratio.
          </Text>

          {loading ? (
            <ActivityIndicator style={styles.sheetLoader} color={colors.primary} />
          ) : floaters.length ? (
            <View style={styles.floaterList}>
              {floaters.map((floater) => {
                const selectedRow = floater.staff_member_id === selectedId;
                return (
                  <TouchableOpacity
                    key={floater.staff_member_id}
                    style={[styles.floaterRow, selectedRow && styles.floaterRowSelected]}
                    onPress={() => setSelectedId(floater.staff_member_id)}
                    activeOpacity={0.76}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: selectedRow }}
                  >
                    <View style={styles.floaterAvatar}>
                      <Text style={styles.floaterInitials}>{initials(floater.full_name)}</Text>
                    </View>
                    <View style={styles.floaterCopy}>
                      <Text style={styles.floaterName}>{floater.full_name}</Text>
                      <Text style={[styles.floaterNote, !floater.current_classroom_id && styles.availableNote]}>
                        {floater.availability_note}
                      </Text>
                    </View>
                    <View style={[styles.radio, selectedRow && styles.radioSelected]}>
                      {selectedRow && <Ionicons name="checkmark" size={14} color={colors.white} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.noFloaters}>
              <Ionicons name="people-outline" size={24} color={colors.textFaint} />
              <Text style={styles.noFloatersTitle}>No safe floater is available</Text>
              <Text style={styles.noFloatersText}>
                Staff in another room only appear when that room remains in ratio after they move.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.confirmButton, (!selected || saving) && styles.confirmButtonDisabled]}
            onPress={confirm}
            disabled={!selected || saving}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.confirmButtonText}>
                {selected ? `Confirm & assign ${selected.full_name.split(' ')[0]}` : 'Choose an educator'}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.licensingNote}>Logged to the ratio record for licensing.</Text>
        </View>
      </View>
    </Modal>
  );
}

export default function RoomRatiosScreen({ navigation, route }) {
  const { rooms, loading, error, load, loadFloaters, assignFloater } = useRoomRatios();
  const [selectedRoom, setSelectedRoom] = useState(null);
  const handledRoute = useRef(null);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) load({ quiet: rooms.length > 0 });
  }, [isFocused, load]);

  useEffect(() => {
    if (!route.params?.openAssigner || !rooms.length) return;
    const key = `${route.params.roomId || ''}:${route.params.openAssigner}`;
    if (handledRoute.current === key) return;
    const room = rooms.find((candidate) => candidate.id === route.params.roomId)
      || rooms.find((candidate) => candidate.is_over_ratio);
    handledRoute.current = key;
    if (room?.is_over_ratio) setSelectedRoom(room);
    navigation.setParams({ openAssigner: false });
  }, [navigation, rooms, route.params?.openAssigner, route.params?.roomId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Room ratios</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={loading && rooms.length > 0}
            onRefresh={() => load()}
            tintColor={colors.primary}
          />
        )}
      >
        {loading && !rooms.length ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.primary} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Room ratios are unavailable</Text>
            <Text style={styles.errorText}>{error.message}</Text>
            <TouchableOpacity onPress={() => load()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : rooms.length ? (
          rooms.map((room) => (
            <RatioCard key={room.id} room={room} onAssign={setSelectedRoom} />
          ))
        ) : (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>No rooms yet</Text>
            <Text style={styles.errorText}>Rooms appear here after your center creates them.</Text>
          </View>
        )}
      </ScrollView>

      <FloaterSheet
        room={selectedRoom}
        visible={Boolean(selectedRoom)}
        onClose={() => setSelectedRoom(null)}
        loadFloaters={loadFloaters}
        assignFloater={assignFloater}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
  },
  pageTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl, gap: spacing.md },
  loader: { marginTop: 80 },
  roomCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  roomCardOver: { borderColor: '#F0C9BB' },
  roomHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomName: { fontSize: 15.5, fontFamily: fonts.black, color: colors.textPrimary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  overBadge: { backgroundColor: colors.coral },
  okBadge: { backgroundColor: colors.successLight },
  statusText: { fontSize: 11.5, fontFamily: fonts.bold },
  overText: { color: colors.white },
  okText: { color: colors.success },
  ratioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  presentText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textSecondary },
  presentTextOver: { color: colors.coral },
  progressTrack: { flex: 1, height: 7, overflow: 'hidden', borderRadius: radius.full },
  progressTrackOver: { backgroundColor: '#F3DED5' },
  progressTrackOk: { backgroundColor: colors.successLight },
  progressFill: { height: '100%', borderRadius: radius.full },
  progressFillOver: { backgroundColor: colors.coral },
  progressFillOk: { backgroundColor: colors.success },
  staffText: { fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint },
  assignButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  assignButtonText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.white },
  errorCard: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  errorTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary },
  errorText: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  retryButton: { marginTop: spacing.md, padding: spacing.sm },
  retryText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(41, 62, 89, 0.52)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 30,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
  },
  grabber: {
    width: 44,
    height: 5,
    alignSelf: 'center',
    marginBottom: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  sheetTitle: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  sheetSubtitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  sheetLoader: { marginVertical: spacing.xxl },
  floaterList: { gap: spacing.sm },
  floaterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  floaterRowSelected: { borderColor: colors.primary },
  floaterAvatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: colors.primaryLight,
  },
  floaterInitials: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  floaterCopy: { flex: 1 },
  floaterName: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  floaterNote: { marginTop: 2, fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint },
  availableNote: { color: colors.success },
  radio: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.8,
    borderColor: colors.borderStrong,
    borderRadius: 11,
  },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  noFloaters: { alignItems: 'center', paddingVertical: spacing.xl },
  noFloatersTitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  noFloatersText: {
    marginTop: spacing.xs,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  confirmButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmButtonDisabled: { opacity: 0.5 },
  confirmButtonText: { fontSize: 16, fontFamily: fonts.bold, color: colors.white },
  licensingNote: {
    marginTop: spacing.md,
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
