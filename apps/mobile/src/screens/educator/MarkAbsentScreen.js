import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { markChildAbsent } from '../../hooks/useRollCall';
import { colors, fonts, radius, spacing } from '../../theme';

const REASONS = [
  { value: 'sick', label: 'Sick', icon: 'medical-outline' },
  { value: 'vacation', label: 'Vacation', icon: 'airplane-outline' },
  { value: 'appointment', label: 'Appointment', icon: 'calendar-outline' },
  { value: 'family_day', label: 'Family day', icon: 'home-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

function initials(child) {
  return `${child?.firstName?.[0] || ''}${child?.lastName?.[0] || ''}`.toUpperCase();
}

export default function MarkAbsentScreen({ navigation, route }) {
  const child = route.params?.child;
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [notifyOffice, setNotifyOffice] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!child || !reason || saving) return;
    setSaving(true);
    try {
      await markChildAbsent(child.id, { reason, note, notifyOffice });
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not mark absent', error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Mark absent</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.childCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(child)}</Text>
            </View>
            <View style={styles.childCopy}>
              <Text style={styles.childName}>{child?.fullName || 'Child'}</Text>
              <Text style={styles.childMeta}>This absence will be added to today’s signed record.</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Reason</Text>
          <View style={styles.reasonList}>
            {REASONS.map((option) => {
              const selected = reason === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                  onPress={() => setReason(option.value)}
                  activeOpacity={0.76}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={[styles.reasonIcon, selected && styles.reasonIconSelected]}>
                    <Ionicons
                      name={option.icon}
                      size={20}
                      color={selected ? colors.primary : colors.textMuted}
                    />
                  </View>
                  <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                    {option.label}
                  </Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Optional note</Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={(value) => setNote(value.slice(0, 500))}
            placeholder="Anything the office or classroom team should know"
            placeholderTextColor={colors.textFaint}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Optional absence note"
          />
          <Text style={styles.characterCount}>{note.length}/500</Text>

          <View style={styles.notifyCard}>
            <View style={styles.notifyIcon}>
              <Ionicons name="notifications-outline" size={21} color={colors.primary} />
            </View>
            <View style={styles.notifyCopy}>
              <Text style={styles.notifyTitle}>Notify the office</Text>
              <Text style={styles.notifyText}>Keeps the admin no-show follow-up list current.</Text>
            </View>
            <Switch
              value={notifyOffice}
              onValueChange={setNotifyOffice}
              trackColor={{ false: colors.border, true: '#A8CBF3' }}
              thumbColor={notifyOffice ? colors.primary : colors.white}
              accessibilityLabel="Notify the office"
            />
          </View>

          <View style={styles.safetyNote}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textFaint} />
            <Text style={styles.safetyText}>
              A checked-in child can’t be overwritten as absent. Check them out first so the attendance history stays intact.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, (!reason || saving) && styles.disabled]}
            onPress={save}
            disabled={!reason || saving}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color={colors.white} /> : (
              <Text style={styles.saveButtonText}>Mark absent</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  header: {
    minHeight: 66, flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    paddingHorizontal: spacing.lg, backgroundColor: colors.surface,
  },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontFamily: fonts.bold },
  headerSpacer: { width: 32 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  childCard: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.lg,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontSize: 15, fontFamily: fonts.bold },
  childCopy: { flex: 1, marginLeft: spacing.md },
  childName: { color: colors.textPrimary, fontSize: 16, fontFamily: fonts.bold },
  childMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  reasonList: { gap: spacing.sm },
  reasonRow: {
    minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  reasonRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reasonIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.bg },
  reasonIconSelected: { backgroundColor: colors.primaryLight },
  reasonText: { flex: 1, marginLeft: spacing.md, color: colors.textSecondary, fontSize: 14, fontFamily: fonts.bold },
  reasonTextSelected: { color: colors.textPrimary },
  radio: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: 11 },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  fieldLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  noteInput: {
    minHeight: 104, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, backgroundColor: colors.surface,
    color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular,
  },
  characterCount: { marginTop: 5, textAlign: 'right', color: colors.textFaint, fontSize: 11, fontFamily: fonts.regular },
  notifyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg,
    padding: spacing.md, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, backgroundColor: colors.surface,
  },
  notifyIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primaryLight },
  notifyCopy: { flex: 1 },
  notifyTitle: { color: colors.textPrimary, fontSize: 13.5, fontFamily: fonts.bold },
  notifyText: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular },
  safetyNote: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  safetyText: { flex: 1, color: colors.textFaint, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  saveButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  saveButtonText: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },
});
