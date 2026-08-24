import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../hooks/useAuth';
import {
  addAuthorizedPickup,
  getParentPickupOptions,
  removeAuthorizedPickup,
} from '../../hooks/usePickupVerification';
import { colors, fonts, radius, spacing } from '../../theme';

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();
}

function PickupPersonRow({ person, currentUserId, onRemove }) {
  const isSelf = person.source_id === currentUserId;
  return (
    <View style={[styles.personRow, !person.is_active && styles.personRowRemoved]}>
      <View style={[styles.avatar, !person.is_active && styles.avatarRemoved]}>
        <Text style={[styles.avatarText, !person.is_active && styles.avatarTextRemoved]}>
          {initials(person.full_name)}
        </Text>
      </View>
      <View style={styles.personCopy}>
        <View style={styles.personNameRow}>
          <Text style={[styles.personName, !person.is_active && styles.removedText]} numberOfLines={1}>
            {isSelf ? 'You' : person.full_name}
          </Text>
          {person.is_primary && <Text style={styles.primaryBadge}>Primary</Text>}
          {!person.is_active && <Text style={styles.removedBadge}>Removed</Text>}
        </View>
        <Text style={[styles.personRelationship, !person.is_active && styles.removedText]}>
          {person.relationship || 'Authorized pickup'}
          {person.phone ? ` · ${person.phone}` : ''}
        </Text>
      </View>
      {person.source_type === 'pickup' && person.is_active && !person.is_primary && (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => onRemove(person)}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${person.full_name}`}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      )}
      {person.is_active && person.source_type === 'profile' && (
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
      )}
    </View>
  );
}

function AddPickupSheet({ visible, onClose, onAdded }) {
  const [fullName, setFullName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setFullName('');
      setRelationship('');
      setPhone('');
      setError(null);
    }
  }, [visible]);

  async function save() {
    if (!fullName.trim() || !relationship.trim()) {
      setError('Full name and relationship are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdded({
        fullName: fullName.trim(),
        relationship: relationship.trim(),
        phone: phone.trim(),
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message);
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
          <Text style={styles.sheetTitle}>Add authorized pickup</Text>
          <Text style={styles.sheetText}>
            Only add someone you trust to take this child home. Educators still verify their pass at the door.
          </Text>
          <Text style={styles.inputLabel}>Full name *</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={(value) => { setFullName(value); setError(null); }}
            placeholder="e.g. Sarah Turner"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
            maxLength={120}
          />
          <Text style={styles.inputLabel}>Relationship *</Text>
          <TextInput
            style={styles.input}
            value={relationship}
            onChangeText={(value) => { setRelationship(value); setError(null); }}
            placeholder="e.g. Grandparent"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
            maxLength={80}
          />
          <Text style={styles.inputLabel}>Phone number (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. 905-555-0100"
            placeholderTextColor={colors.textFaint}
            keyboardType="phone-pad"
            maxLength={40}
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.disabled]}
            onPress={save}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.saveButtonText}>Add authorized pickup</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function AuthorizedPickupsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const child = route.params?.child || null;
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!child?.id) {
      setError('Choose a child to manage authorized pickups.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getParentPickupOptions(child.id, true);
      setPeople(rows);
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [child?.id]);

  useEffect(() => { load(); }, [load]);

  async function add(values) {
    await addAuthorizedPickup(child.id, values);
    await load();
  }

  function confirmRemove(person) {
    Alert.alert(
      `Remove ${person.full_name}?`,
      'Any active mobile pass for this person will stop working immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              await removeAuthorizedPickup(person.source_id);
              await load();
            } catch (removeError) {
              Alert.alert('Could not remove pickup', removeError.message);
            }
          },
        },
      ]
    );
  }

  const active = people.filter((person) => person.is_active);
  const removed = people.filter((person) => !person.is_active);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Authorized pickups</Text>
          <Text style={styles.subtitle}>{child?.first_name} {child?.last_name}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} />
          <Text style={styles.infoText}>
            Educators release {child?.first_name || 'your child'} only after a current pass matches someone on this list.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.primary} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Can pick up</Text>
            <View style={styles.listCard}>
              {active.map((person, index) => (
                <View key={`${person.source_type}:${person.source_id}`}>
                  {index > 0 && <View style={styles.divider} />}
                  <PickupPersonRow person={person} currentUserId={profile?.id} onRemove={confirmRemove} />
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.addButton} onPress={() => setShowAdd(true)}>
              <Ionicons name="add" size={21} color={colors.white} />
              <Text style={styles.addButtonText}>Add authorized pickup</Text>
            </TouchableOpacity>

            {removed.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, styles.removedTitle]}>Previously removed</Text>
                <View style={styles.listCard}>
                  {removed.map((person, index) => (
                    <View key={`${person.source_type}:${person.source_id}`}>
                      {index > 0 && <View style={styles.divider} />}
                      <PickupPersonRow person={person} currentUserId={profile?.id} onRemove={confirmRemove} />
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <AddPickupSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={add}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.primarySoft,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 22, fontFamily: fonts.black },
  subtitle: { marginTop: 1, color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.regular },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryLight,
  },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular },
  loader: { marginTop: 80 },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 15, fontFamily: fonts.black },
  removedTitle: { color: colors.textMuted },
  listCard: {
    overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  personRow: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  personRowRemoved: { backgroundColor: '#FAFBFD' },
  avatar: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: 21, backgroundColor: colors.primaryLight,
  },
  avatarRemoved: { backgroundColor: '#EEF2F7' },
  avatarText: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  avatarTextRemoved: { color: colors.textFaint },
  personCopy: { flex: 1, minWidth: 0 },
  personNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  personName: { flexShrink: 1, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.bold },
  personRelationship: { marginTop: 2, color: colors.textMuted, fontSize: 11.5, fontFamily: fonts.regular },
  removedText: { color: colors.textFaint },
  primaryBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: colors.successLight, color: colors.success, fontSize: 9.5, fontFamily: fonts.bold,
  },
  removedBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: '#EEF2F7', color: colors.textFaint, fontSize: 9.5, fontFamily: fonts.bold,
  },
  removeButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.dangerLight,
  },
  divider: { height: 1, marginLeft: 66, backgroundColor: colors.borderSoft },
  addButton: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  addButtonText: { color: colors.white, fontSize: 14.5, fontFamily: fonts.bold },
  errorCard: {
    alignItems: 'center', marginTop: spacing.xxl, padding: spacing.xl,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  errorText: { color: colors.danger, textAlign: 'center', fontSize: 12.5, lineHeight: 18, fontFamily: fonts.bold },
  retryButton: { marginTop: spacing.md, padding: spacing.sm },
  retryText: { color: colors.primary, fontFamily: fonts.bold },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(35, 53, 77, 0.55)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 30,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.bg,
  },
  grabber: { width: 44, height: 5, alignSelf: 'center', marginBottom: spacing.lg, borderRadius: 3, backgroundColor: colors.borderStrong },
  sheetTitle: { color: colors.textPrimary, fontSize: 21, fontFamily: fonts.black },
  sheetText: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular },
  inputLabel: { marginTop: spacing.lg, marginBottom: spacing.sm, color: colors.textPrimary, fontSize: 12.5, fontFamily: fonts.bold },
  input: {
    minHeight: 50, paddingHorizontal: spacing.md, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    color: colors.textPrimary, fontSize: 14, fontFamily: fonts.regular,
  },
  saveButton: {
    minHeight: 54, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  saveButtonText: { color: colors.white, fontSize: 15, fontFamily: fonts.bold },
  cancelButton: { alignItems: 'center', padding: spacing.md },
  cancelButtonText: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },
});
